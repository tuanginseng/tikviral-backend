"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AffiliateService = void 0;
const common_1 = require("@nestjs/common");
const supabase_service_1 = require("../supabase/supabase.service");
let AffiliateService = class AffiliateService {
    supabaseService;
    constructor(supabaseService) {
        this.supabaseService = supabaseService;
    }
    async syncKalodataProducts(kalodataCookie) {
        if (!kalodataCookie) {
            throw new common_1.BadRequestException('Kalodata cookie is required');
        }
        const supabaseAdmin = this.supabaseService.getAdminClient();
        const now = new Date();
        const endDate = now.toISOString().split('T')[0];
        const startDate = new Date(now.setDate(now.getDate() - 29)).toISOString().split('T')[0];
        const kalodataResponse = await fetch('https://www.kalodata.com/product/queryList', {
            method: 'POST',
            headers: {
                'accept': 'application/json, text/plain, */*',
                'content-type': 'application/json',
                'country': 'VN',
                'currency': 'VND',
                'language': 'vi-VN',
                'origin': 'https://www.kalodata.com',
                'Cookie': kalodataCookie,
            },
            body: JSON.stringify({
                country: "VN",
                startDate: startDate,
                endDate: endDate,
                cateIds: [],
                showCateIds: [],
                pageNo: 1,
                pageSize: 50,
                sort: [{ field: "sale", type: "DESC" }]
            }),
        });
        if (!kalodataResponse.ok) {
            throw new common_1.InternalServerErrorException(`Kalodata API failed: ${kalodataResponse.status}`);
        }
        const kalodataData = await kalodataResponse.json();
        if (!kalodataData.success || !kalodataData.data || !Array.isArray(kalodataData.data)) {
            throw new common_1.InternalServerErrorException('Invalid response from Kalodata API');
        }
        const kalodataProducts = kalodataData.data.slice(0, 50);
        const { data: existingProducts, error: fetchError } = await supabaseAdmin
            .from('affiliate_products')
            .select('id, name, image_url, affiliate_link');
        if (fetchError)
            throw new common_1.InternalServerErrorException(fetchError.message);
        const existingProductsMap = new Map((existingProducts || []).map(p => [p.name, p]));
        const productsToUpsertMap = new Map();
        const kalodataProductNames = new Set();
        const parseRevenue = (saleValue) => {
            if (saleValue === null || saleValue === undefined)
                return null;
            const parsed = parseFloat(String(saleValue).replace(/[^0-9.]/g, ''));
            return isNaN(parsed) ? null : parsed;
        };
        for (const kp of kalodataProducts) {
            if (kp.product_title && kp.sale) {
                kalodataProductNames.add(kp.product_title);
                let commissionPercentage = null;
                if (typeof kp.commission_rate === 'string' && kp.commission_rate.includes('%')) {
                    const parsed = parseFloat(kp.commission_rate.replace('%', ''));
                    if (!isNaN(parsed))
                        commissionPercentage = parsed;
                }
                else if (typeof kp.commission_rate === 'number') {
                    commissionPercentage = kp.commission_rate;
                }
                const existingProduct = existingProductsMap.get(kp.product_title);
                const productToUpsert = {
                    name: kp.product_title,
                    commission_percentage: commissionPercentage,
                    revenue: parseRevenue(kp.sale),
                };
                if (existingProduct) {
                    productToUpsert.id = existingProduct.id;
                    productToUpsert.image_url = existingProduct.image_url;
                    productToUpsert.affiliate_link = existingProduct.affiliate_link;
                }
                else {
                    productToUpsert.id = crypto.randomUUID();
                    productToUpsert.image_url = null;
                    productToUpsert.affiliate_link = null;
                }
                productsToUpsertMap.set(kp.product_title, productToUpsert);
            }
        }
        const idsToDelete = (existingProducts || [])
            .filter(p => !kalodataProductNames.has(p.name))
            .map(p => p.id);
        const { error: upsertError } = await supabaseAdmin
            .from('affiliate_products')
            .upsert(Array.from(productsToUpsertMap.values()), { onConflict: 'name', ignoreDuplicates: false });
        if (upsertError)
            throw new common_1.InternalServerErrorException(upsertError.message);
        if (idsToDelete.length > 0) {
            const { error: deleteError } = await supabaseAdmin.from('affiliate_products').delete().in('id', idsToDelete);
            if (deleteError)
                throw new common_1.InternalServerErrorException(deleteError.message);
        }
        return { success: true, message: 'Products synced successfully' };
    }
    async manageProducts(dto) {
        const supabaseAdmin = this.supabaseService.getAdminClient();
        const { action, payload, offset = 0, limit = 10, order } = dto;
        switch (action) {
            case 'get-all': {
                let query = supabaseAdmin.from('affiliate_products').select('*', { count: 'exact' });
                if (order && Array.isArray(order)) {
                    order.forEach((sOption) => { query = query.order(sOption.column, { ascending: sOption.ascending }); });
                }
                else {
                    query = query.order('position', { ascending: true });
                }
                const { data, error, count } = await query.range(offset, offset + limit - 1);
                if (error)
                    throw new common_1.InternalServerErrorException(error.message);
                return { products: data || [], totalCount: count || 0 };
            }
            case 'add': {
                const { data, error } = await supabaseAdmin.from('affiliate_products').insert(payload).select();
                if (error)
                    throw new common_1.InternalServerErrorException(error.message);
                return { message: 'Product added successfully', product: data[0] };
            }
            case 'update': {
                const { id, ...updateData } = payload;
                const { data, error } = await supabaseAdmin.from('affiliate_products').update(updateData).eq('id', id).select();
                if (error)
                    throw new common_1.InternalServerErrorException(error.message);
                return { message: 'Product updated successfully', product: data[0] };
            }
            case 'delete': {
                const { error } = await supabaseAdmin.from('affiliate_products').delete().eq('id', payload.id);
                if (error)
                    throw new common_1.InternalServerErrorException(error.message);
                return { message: 'Product deleted successfully' };
            }
            case 'delete-image': {
                const { error } = await supabaseAdmin.storage.from('affiliate-product-images').remove([payload.fileName]);
                if (error)
                    throw new common_1.InternalServerErrorException(error.message);
                return { message: 'Image deleted successfully' };
            }
            case 'update-positions': {
                const results = await Promise.all(payload.updates.map((item) => supabaseAdmin.from('affiliate_products').update({ position: item.position }).eq('id', item.id)));
                if (results.some(r => r.error))
                    throw new common_1.InternalServerErrorException('Failed to update some positions');
                return { message: 'Product positions updated successfully' };
            }
            default:
                throw new common_1.BadRequestException('Invalid action');
        }
    }
    async manageCommissions(dto) {
        const admin = this.supabaseService.getAdminClient();
        const { action, status: statusFilter, offset = 0, limit = 50, commission_ids, referrer_id, date_from, date_to } = dto;
        const applyDateFilter = (q) => {
            if (date_from)
                q = q.gte("created_at", date_from);
            if (date_to)
                q = q.lte("created_at", date_to);
            return q;
        };
        switch (action) {
            case "list": {
                let query = admin.from("affiliate_commissions").select("id, referrer_id, referral_id, transaction_id, amount, commission_rate, commission_amount, status, created_at, paid_at", { count: "exact" }).order("created_at", { ascending: false });
                if (statusFilter && statusFilter !== "all")
                    query = query.eq("status", statusFilter);
                query = applyDateFilter(query);
                const { data: rows, error, count } = await query.range(Number(offset), Number(offset) + Number(limit) - 1);
                if (error)
                    throw new common_1.InternalServerErrorException(error.message);
                const referrerIds = [...new Set((rows ?? []).map((r) => r.referrer_id))];
                const { data: profiles } = await admin.from("profiles").select("id, email, full_name").in("id", referrerIds);
                const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
                const list = (rows ?? []).map((r) => ({
                    ...r,
                    referrer_email: profileMap.get(r.referrer_id)?.email ?? null,
                    referrer_name: profileMap.get(r.referrer_id)?.full_name ?? null,
                }));
                return { list, total: count ?? 0 };
            }
            case "summary": {
                let sql = admin.from("affiliate_commissions").select("referrer_id, status, commission_amount");
                sql = applyDateFilter(sql);
                const { data: commissions } = await sql;
                const byReferrer = {};
                for (const c of commissions ?? []) {
                    const id = c.referrer_id;
                    if (!byReferrer[id])
                        byReferrer[id] = { referrer_id: id, pending: 0, paid: 0, count_pending: 0, count_paid: 0 };
                    const amt = Number(c.commission_amount);
                    if (c.status === "pending") {
                        byReferrer[id].pending += amt;
                        byReferrer[id].count_pending += 1;
                    }
                    else if (c.status === "paid") {
                        byReferrer[id].paid += amt;
                        byReferrer[id].count_paid += 1;
                    }
                }
                const referrerIds = Object.keys(byReferrer);
                const { data: profiles } = await admin.from("profiles").select("id, email, full_name").in("id", referrerIds);
                const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
                return { summary: referrerIds.map(id => ({ ...byReferrer[id], referrer_email: profileMap.get(id)?.email, referrer_name: profileMap.get(id)?.full_name })) };
            }
            case "get-referrer-bank": {
                const { data: profile, error } = await admin.from("profiles").select("bank_account_holder, bank_account_number, bank_name").eq("id", referrer_id).single();
                if (error || !profile)
                    throw new common_1.NotFoundException("Profile not found");
                return profile;
            }
            case "mark-paid": {
                if (!Array.isArray(commission_ids) || commission_ids.length === 0)
                    throw new common_1.BadRequestException("commission_ids required");
                const { error } = await admin.from("affiliate_commissions").update({ status: "paid", paid_at: new Date().toISOString() }).in("id", commission_ids).eq("status", "pending");
                if (error)
                    throw new common_1.InternalServerErrorException(error.message);
                return { success: true, message: `Marked ${commission_ids.length} items as paid.` };
            }
            default:
                throw new common_1.BadRequestException("Invalid action");
        }
    }
    async recordReferral(token, refCode) {
        const admin = this.supabaseService.getAdminClient();
        const { data: { user }, error: userError } = await admin.auth.getUser(token);
        if (userError || !user)
            throw new common_1.UnauthorizedException("Invalid session");
        const { data: affiliateRow } = await admin.from("affiliate_codes").select("user_id").eq("code", refCode).eq("is_active", true).maybeSingle();
        if (!affiliateRow)
            return { success: false, message: "Mã giới thiệu không hợp lệ" };
        if (affiliateRow.user_id === user.id)
            return { success: false, message: "Không thể dùng mã của chính mình" };
        const REF_MAX_AGE_MS = 24 * 60 * 60 * 1000;
        if (Date.now() - (user.created_at ? new Date(user.created_at).getTime() : 0) > REF_MAX_AGE_MS) {
            return { success: false, message: "Chỉ có thể gắn mã giới thiệu khi đăng ký mới (trong vòng 24h)" };
        }
        const { data: existing } = await admin.from("referrals").select("id").eq("referred_user_id", user.id).maybeSingle();
        if (existing)
            return { success: false, message: "Tài khoản đã được gắn giới thiệu trước đó" };
        await admin.from("referrals").insert({ referrer_id: affiliateRow.user_id, referred_user_id: user.id });
        return { success: true, message: "Đã ghi nhận giới thiệu" };
    }
    async uploadAffiliateImage(imageData, mimeType, fileName) {
        const admin = this.supabaseService.getAdminClient();
        const imageBuffer = Buffer.from(imageData, 'base64');
        const { error } = await admin.storage.from('affiliate-product-images').upload(fileName, imageBuffer, {
            contentType: mimeType,
            upsert: false,
        });
        if (error)
            throw new common_1.InternalServerErrorException(error.message);
        const { data: publicUrlData } = admin.storage.from('affiliate-product-images').getPublicUrl(fileName);
        return { publicUrl: publicUrlData.publicUrl };
    }
};
exports.AffiliateService = AffiliateService;
exports.AffiliateService = AffiliateService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService])
], AffiliateService);
//# sourceMappingURL=affiliate.service.js.map