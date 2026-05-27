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
var UsageService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsageService = void 0;
const common_1 = require("@nestjs/common");
const supabase_service_1 = require("../supabase/supabase.service");
let UsageService = UsageService_1 = class UsageService {
    supabaseService;
    logger = new common_1.Logger(UsageService_1.name);
    constructor(supabaseService) {
        this.supabaseService = supabaseService;
    }
    async checkUsage(userId) {
        const supabase = this.supabaseService.getAdminClient();
        const { data, error } = await supabase.rpc('check_usage_only', {
            p_user_id: userId,
        });
        if (error) {
            this.logger.error(`check_usage_only error for user ${userId}: ${error.message}`);
            throw new Error(error.message);
        }
        return data;
    }
    async incrementUsage(userId) {
        const supabase = this.supabaseService.getAdminClient();
        const { data, error } = await supabase.rpc('increment_usage_after_success', {
            p_user_id: userId,
        });
        if (error) {
            this.logger.error(`increment_usage_after_success error for user ${userId}: ${error.message}`);
            throw new Error(error.message);
        }
        return data;
    }
    async getProfile(userId) {
        const supabase = this.supabaseService.getAdminClient();
        const { data, error } = await supabase
            .from('profiles')
            .select('subscription_tier, subscription_end_date, monthly_usage_count, credit_balance, monthly_credit_balance, monthly_credit_expires_at')
            .eq('id', userId)
            .single();
        if (error) {
            this.logger.error(`getProfile error for user ${userId}: ${error.message}`);
            throw new Error(error.message);
        }
        return data;
    }
    async resetExpiredSubscription(userId) {
        const supabase = this.supabaseService.getAdminClient();
        const { error } = await supabase
            .from('profiles')
            .update({
            subscription_tier: 'free',
            subscription_end_date: null,
            monthly_credit_balance: 0,
            monthly_credit_expires_at: null
        })
            .eq('id', userId);
        if (error) {
            this.logger.error(`resetExpiredSubscription error for user ${userId}: ${error.message}`);
            throw new Error(error.message);
        }
        return { success: true };
    }
    async saveVideoAnalysis(userId, payload) {
        const supabase = this.supabaseService.getAdminClient();
        const { data, error } = await supabase
            .from('video_analyses')
            .insert({ ...payload, user_id: userId })
            .select('id, video_title, video_url, cover_image_url')
            .single();
        if (error) {
            this.logger.error(`saveVideoAnalysis error for user ${userId}: ${error.message}`);
            throw new Error(error.message);
        }
        return data;
    }
    async saveGeneratedScript(userId, payload) {
        const supabase = this.supabaseService.getAdminClient();
        const { error } = await supabase
            .from('generated_scripts')
            .insert({ ...payload, user_id: userId });
        if (error) {
            this.logger.error(`saveGeneratedScript error for user ${userId}: ${error.message}`);
            throw new Error(error.message);
        }
        return { success: true };
    }
    async getLatestVideoAnalysis(userId) {
        const supabase = this.supabaseService.getAdminClient();
        const { data } = await supabase
            .from('video_analyses')
            .select('id, video_title, video_url, cover_image_url')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
        return data;
    }
    async saveViolationAppeal(userId, payload) {
        const supabase = this.supabaseService.getAdminClient();
        const { error } = await supabase
            .from('violation_appeals')
            .insert({ ...payload, user_id: userId });
        if (error) {
            this.logger.error(`saveViolationAppeal error for user ${userId}: ${error.message}`);
            throw new Error(error.message);
        }
        return { success: true };
    }
    async saveScriptCheck(userId, payload) {
        const supabase = this.supabaseService.getAdminClient();
        const { error } = await supabase
            .from('script_checks')
            .insert({ ...payload, user_id: userId });
        if (error) {
            this.logger.error(`saveScriptCheck error for user ${userId}: ${error.message}`);
            throw new Error(error.message);
        }
        return { success: true };
    }
    async ensureAffiliateCode(userId, code) {
        const supabase = this.supabaseService.getAdminClient();
        const { data: existing } = await supabase
            .from('affiliate_codes')
            .select('code')
            .eq('user_id', userId)
            .maybeSingle();
        if (existing) {
            return { code: existing.code, created: false };
        }
        const { error } = await supabase.from('affiliate_codes').insert({
            user_id: userId,
            code,
        });
        if (error) {
            this.logger.error(`ensureAffiliateCode error for user ${userId}: ${error.message}`);
            throw error;
        }
        return { code, created: true };
    }
    async createPaymentTransaction(userId, payload) {
        const supabase = this.supabaseService.getAdminClient();
        const { data, error } = await supabase
            .from('payment_transactions')
            .insert({ ...payload, user_id: userId, status: 'pending' })
            .select('id')
            .single();
        if (error) {
            this.logger.error('createPaymentTransaction error: ' + error.message);
            throw new Error(error.message);
        }
        return data;
    }
    async getPaymentTransactionStatus(userId, transactionId) {
        const supabase = this.supabaseService.getAdminClient();
        const { data, error } = await supabase
            .from('payment_transactions')
            .select('status')
            .eq('id', transactionId)
            .eq('user_id', userId)
            .single();
        if (error)
            throw new Error(error.message);
        return data;
    }
    async getHistory(userId, table, page, perPage) {
        const supabase = this.supabaseService.getAdminClient();
        const allowed = ['video_analyses', 'generated_scripts', 'script_checks', 'violation_appeals', 'upscaled_videos'];
        if (!allowed.includes(table))
            throw new Error('Invalid table');
        const from = (page - 1) * perPage;
        const to = from + perPage - 1;
        const { data, error, count } = await supabase
            .from(table)
            .select('*', { count: 'exact' })
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .range(from, to);
        if (error) {
            this.logger.error('getHistory(' + table + ') error: ' + error.message);
            throw new Error(error.message);
        }
        return { data: data ?? [], count: count ?? 0 };
    }
    async getReferralStats(userId, dateFrom, dateTo, page, perPage) {
        const supabase = this.supabaseService.getAdminClient();
        const { data: codeData } = await supabase
            .from('affiliate_codes')
            .select('code')
            .eq('user_id', userId)
            .maybeSingle();
        const { count: referralsCount } = await supabase
            .from('referrals')
            .select('*', { count: 'exact', head: true })
            .eq('referrer_id', userId);
        const { data: paidReferrals } = await supabase
            .from('referrals')
            .select('id')
            .eq('referrer_id', userId)
            .not('first_payment_at', 'is', null);
        const paidReferralsCount = paidReferrals?.length ?? 0;
        const from = (page - 1) * perPage;
        const to = from + perPage - 1;
        const { data: commissionRows, count } = await supabase
            .from('affiliate_commissions')
            .select('id, amount, commission_amount, status, created_at', { count: 'exact' })
            .eq('referrer_id', userId)
            .gte('created_at', dateFrom)
            .lte('created_at', dateTo)
            .order('created_at', { ascending: false })
            .range(from, to);
        const { data: profile } = await supabase
            .from('profiles')
            .select('bank_account_holder, bank_account_number, bank_name')
            .eq('id', userId)
            .single();
        return {
            code: codeData?.code ?? null,
            referralsCount: referralsCount ?? 0,
            paidReferralsCount,
            commissions: commissionRows ?? [],
            commissionsTotal: count ?? 0,
            profile: profile ?? { bank_account_holder: null, bank_account_number: null, bank_name: null }
        };
    }
    async updateBankAccount(userId, payload) {
        const supabase = this.supabaseService.getAdminClient();
        const { error } = await supabase
            .from('profiles')
            .update(payload)
            .eq('id', userId);
        if (error) {
            this.logger.error('updateBankAccount error: ' + error.message);
            throw new Error(error.message);
        }
        return { success: true };
    }
    async deductCredits(userId, amount) {
        if (amount <= 0)
            return { success: true };
        const supabase = this.supabaseService.getAdminClient();
        const { data: profile, error: getError } = await supabase
            .from('profiles')
            .select('monthly_credit_balance, credit_balance, monthly_usage_count')
            .eq('id', userId)
            .single();
        if (getError || !profile) {
            this.logger.error(`deductCredits error getting profile for user ${userId}: ${getError?.message}`);
            return { success: false, error: 'Không tìm thấy profile' };
        }
        let remainingToDeduct = amount;
        let newMonthlyBalance = profile.monthly_credit_balance || 0;
        let newPurchasedBalance = profile.credit_balance || 0;
        let newUsageCount = profile.monthly_usage_count || 0;
        if (newMonthlyBalance > 0) {
            const deductFromMonthly = Math.min(newMonthlyBalance, remainingToDeduct);
            newMonthlyBalance -= deductFromMonthly;
            remainingToDeduct -= deductFromMonthly;
        }
        if (remainingToDeduct > 0 && newPurchasedBalance > 0) {
            const deductFromPurchased = Math.min(newPurchasedBalance, remainingToDeduct);
            newPurchasedBalance -= deductFromPurchased;
            remainingToDeduct -= deductFromPurchased;
        }
        if (remainingToDeduct > 0) {
            this.logger.log(`[deductCredits] User ${userId} ran out of credits. Capped at 0 (Option B - ignored remaining ${remainingToDeduct} credits).`);
            remainingToDeduct = 0;
        }
        const updatePayload = {
            monthly_credit_balance: newMonthlyBalance,
            credit_balance: newPurchasedBalance,
            monthly_usage_count: newUsageCount,
        };
        const { error: updateError } = await supabase
            .from('profiles')
            .update(updatePayload)
            .eq('id', userId);
        if (updateError) {
            this.logger.error(`deductCredits error updating profile for user ${userId}: ${updateError.message}`);
            return { success: false, error: updateError.message };
        }
        this.logger.log(`Successfully deducted ${amount} credits for user ${userId}. New balances: monthly=${newMonthlyBalance}, purchased=${newPurchasedBalance}, usage=${newUsageCount}`);
        return { success: true };
    }
    async refundCredit(userId) {
        const supabase = this.supabaseService.getAdminClient();
        try {
            const { data: profile, error: getError } = await supabase
                .from('profiles')
                .select('monthly_credit_balance, subscription_tier')
                .eq('id', userId)
                .single();
            if (getError || !profile) {
                this.logger.error(`refundCredit error getting profile for user ${userId}: ${getError?.message}`);
                return { success: false, error: 'Không tìm thấy profile' };
            }
            const newBalance = (profile.monthly_credit_balance || 0) + 1;
            const updatePayload = {
                monthly_credit_balance: newBalance,
            };
            if (profile.subscription_tier === 'free') {
                updatePayload.subscription_tier = 'premium';
            }
            const { error: updateError } = await supabase
                .from('profiles')
                .update(updatePayload)
                .eq('id', userId);
            if (updateError) {
                this.logger.error(`refundCredit error updating profile for user ${userId}: ${updateError.message}`);
                return { success: false, error: updateError.message };
            }
            this.logger.log(`Successfully refunded 1 credit for user ${userId}. New monthly balance: ${newBalance}`);
            return { success: true };
        }
        catch (e) {
            this.logger.error(`refundCredit exception for user ${userId}: ${e.message}`);
            return { success: false, error: e.message };
        }
    }
};
exports.UsageService = UsageService;
exports.UsageService = UsageService = UsageService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService])
], UsageService);
//# sourceMappingURL=usage.service.js.map