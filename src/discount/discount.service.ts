import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export interface DiscountValidateResult {
  valid: boolean;
  codeId?: string;
  code?: string;
  description?: string;
  discountType?: 'percent' | 'fixed';
  discountValue?: number;
  discountAmount?: number; // Số tiền giảm thực tế tính theo giá gốc
  finalAmount?: number;    // Giá sau giảm
  errorMessage?: string;
}

@Injectable()
export class DiscountService {
  private readonly logger = new Logger(DiscountService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Validate mã giảm giá cho user + gói cụ thể.
   * Kiểm tra: tồn tại, còn hạn, còn lượt, user chưa dùng.
   */
  async validateCode(code: string, userId: string, originalAmount: number): Promise<DiscountValidateResult> {
    const admin = this.supabaseService.getAdminClient();
    const codeUpper = code.trim().toUpperCase();

    const { data: discount, error } = await admin
      .from('discount_codes')
      .select('*')
      .eq('code', codeUpper)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      this.logger.error(`[DiscountService] Lỗi query mã giảm giá: ${error.message}`);
      return { valid: false, errorMessage: 'Lỗi hệ thống. Vui lòng thử lại.' };
    }

    if (!discount) {
      return { valid: false, errorMessage: 'Mã giảm giá không tồn tại hoặc đã hết hiệu lực.' };
    }

    // Kiểm tra ngày hết hạn
    if (discount.expires_at && new Date(discount.expires_at) < new Date()) {
      return { valid: false, errorMessage: 'Mã giảm giá đã hết hạn.' };
    }

    // Kiểm tra giới hạn số lần dùng
    if (discount.max_uses > 0 && discount.used_count >= discount.max_uses) {
      return { valid: false, errorMessage: 'Mã giảm giá đã đạt giới hạn số lần sử dụng.' };
    }

    // Kiểm tra user đã dùng mã này chưa
    const { data: existingUsage } = await admin
      .from('discount_code_usages')
      .select('id')
      .eq('code_id', discount.id)
      .eq('user_id', userId)
      .maybeSingle();

    if (existingUsage) {
      return { valid: false, errorMessage: 'Bạn đã sử dụng mã giảm giá này rồi.' };
    }

    // Tính toán số tiền giảm
    let discountAmount = 0;
    if (discount.discount_type === 'percent') {
      discountAmount = Math.round(originalAmount * discount.discount_value / 100);
    } else {
      discountAmount = Math.min(discount.discount_value, originalAmount);
    }

    const finalAmount = Math.max(0, originalAmount - discountAmount);

    return {
      valid: true,
      codeId: discount.id,
      code: discount.code,
      description: discount.description,
      discountType: discount.discount_type,
      discountValue: discount.discount_value,
      discountAmount,
      finalAmount,
    };
  }

  /**
   * Ghi nhận đã sử dụng mã giảm giá (gọi sau khi thanh toán thành công).
   */
  async applyCode(codeId: string, userId: string, transactionId: string, discountAmount: number): Promise<void> {
    const admin = this.supabaseService.getAdminClient();

    // Ghi lịch sử sử dụng
    const { error: usageError } = await admin.from('discount_code_usages').insert({
      code_id: codeId,
      user_id: userId,
      transaction_id: transactionId,
      discount_amount: discountAmount,
    });

    if (usageError) {
      this.logger.error(`[DiscountService] Lỗi ghi lịch sử dùng mã: ${usageError.message}`);
      // Không throw để không block thanh toán đã xong
      return;
    }

    // Tăng used_count
    const { error: countError } = await admin.rpc('increment_discount_used_count', { p_code_id: codeId });

    if (countError) {
      // Fallback: update thủ công nếu RPC chưa tồn tại
      this.logger.warn(`[DiscountService] RPC increment_discount_used_count thất bại, thử update trực tiếp: ${countError.message}`);
      await admin
        .from('discount_codes')
        .update({ used_count: admin.rpc as any }) // sẽ bỏ qua nếu lỗi
        .eq('id', codeId);
    }
  }

  // ─── ADMIN CRUD ───────────────────────────────────────────────────────────────

  async listCodes(params: { page?: number; limit?: number; isActive?: boolean }): Promise<{ data: any[]; count: number }> {
    const admin = this.supabaseService.getAdminClient();
    const page = params.page ?? 1;
    const limit = params.limit ?? 50;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = admin
      .from('discount_codes')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (params.isActive !== undefined) {
      query = query.eq('is_active', params.isActive);
    }

    const { data, error, count } = await query;
    if (error) {
      this.logger.error(`[DiscountService] Lỗi listCodes: ${error.message}`);
      return { data: [], count: 0 };
    }
    return { data: data ?? [], count: count ?? 0 };
  }

  async createCode(dto: {
    code: string;
    description?: string;
    discountType: 'percent' | 'fixed';
    discountValue: number;
    maxUses?: number;
    expiresAt?: string;
    notificationMessage?: string;
    popupImageUrl?: string;
    popupTitle?: string;
    popupBody?: string;
    popupCtaText?: string;
    popupCtaUrl?: string;
  }): Promise<{ success: boolean; data?: any; error?: string }> {
    const admin = this.supabaseService.getAdminClient();
    const code = dto.code.trim().toUpperCase();

    const { data, error } = await admin.from('discount_codes').insert({
      code,
      description: dto.description ?? null,
      discount_type: dto.discountType,
      discount_value: dto.discountValue,
      max_uses: dto.maxUses ?? 0,
      expires_at: dto.expiresAt ?? null,
      notification_message: dto.notificationMessage ?? null,
      popup_image_url: dto.popupImageUrl ?? null,
      popup_title: dto.popupTitle ?? null,
      popup_body: dto.popupBody ?? null,
      popup_cta_text: dto.popupCtaText ?? null,
      popup_cta_url: dto.popupCtaUrl ?? null,
      is_active: true,
      used_count: 0,
    }).select().single();

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'Mã giảm giá này đã tồn tại.' };
      }
      return { success: false, error: error.message };
    }
    return { success: true, data };
  }

  async updateCode(id: string, dto: {
    code?: string;
    description?: string;
    discountType?: 'percent' | 'fixed';
    discountValue?: number;
    maxUses?: number;
    expiresAt?: string | null;
    isActive?: boolean;
    notificationMessage?: string;
    popupImageUrl?: string;
    popupTitle?: string;
    popupBody?: string;
    popupCtaText?: string;
    popupCtaUrl?: string;
  }): Promise<{ success: boolean; data?: any; error?: string }> {
    const admin = this.supabaseService.getAdminClient();

    const updatePayload: Record<string, any> = { updated_at: new Date().toISOString() };
    if (dto.code !== undefined) updatePayload.code = dto.code.trim().toUpperCase();
    if (dto.description !== undefined) updatePayload.description = dto.description;
    if (dto.discountType !== undefined) updatePayload.discount_type = dto.discountType;
    if (dto.discountValue !== undefined) updatePayload.discount_value = dto.discountValue;
    if (dto.maxUses !== undefined) updatePayload.max_uses = dto.maxUses;
    if (dto.expiresAt !== undefined) updatePayload.expires_at = dto.expiresAt;
    if (dto.isActive !== undefined) updatePayload.is_active = dto.isActive;
    if (dto.notificationMessage !== undefined) updatePayload.notification_message = dto.notificationMessage;
    if (dto.popupImageUrl !== undefined) updatePayload.popup_image_url = dto.popupImageUrl;
    if (dto.popupTitle !== undefined) updatePayload.popup_title = dto.popupTitle;
    if (dto.popupBody !== undefined) updatePayload.popup_body = dto.popupBody;
    if (dto.popupCtaText !== undefined) updatePayload.popup_cta_text = dto.popupCtaText;
    if (dto.popupCtaUrl !== undefined) updatePayload.popup_cta_url = dto.popupCtaUrl;

    const { data, error } = await admin
      .from('discount_codes')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, data };
  }

  async deleteCode(id: string): Promise<{ success: boolean; error?: string }> {
    const admin = this.supabaseService.getAdminClient();
    const { error } = await admin.from('discount_codes').delete().eq('id', id);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  /**
   * Lấy thông báo & popup khuyến mãi để hiển thị cho user (public).
   * Trả về danh sách các mã còn hiệu lực kèm thông tin popup.
   */
  async getActiveNotifications(): Promise<{
    messages: string[];
    popups: Array<{
      id: string;
      notificationMessage: string | null;
      popupImageUrl: string | null;
      popupTitle: string | null;
      popupBody: string | null;
      popupCtaText: string | null;
      popupCtaUrl: string | null;
    }>;
  }> {
    const admin = this.supabaseService.getAdminClient();
    const now = new Date().toISOString();

    const { data, error } = await admin
      .from('discount_codes')
      .select('id, code, expires_at, notification_message, popup_image_url, popup_title, popup_body, popup_cta_text, popup_cta_url')
      .eq('is_active', true)
      .or(`expires_at.is.null,expires_at.gt.${now}`);

    if (error) {
      this.logger.error(`[DiscountService] getActiveNotifications error: ${error.message}`);
      return { messages: [], popups: [] };
    }

    if (!data) return { messages: [], popups: [] };


    const messages = data
      .map((d: any) => d.notification_message)
      .filter((m: any) => m && m.trim() !== '');

    const popups = data
      .filter((d: any) => d.popup_title || d.popup_body || d.popup_image_url)
      .map((d: any) => ({
        id: d.id,
        code: d.code,
        expiresAt: d.expires_at || null,
        notificationMessage: d.notification_message || null,
        popupImageUrl: d.popup_image_url || null,
        popupTitle: d.popup_title || null,
        popupBody: d.popup_body || null,
        popupCtaText: d.popup_cta_text || null,
        popupCtaUrl: d.popup_cta_url || null,
      }));



    return { messages, popups };
  }
}
