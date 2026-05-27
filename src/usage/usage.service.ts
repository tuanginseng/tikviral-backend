import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Kiểm tra số lượt còn lại của user (không trừ lượt).
   */
  async checkUsage(userId: string) {
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

  /**
   * Tăng số lượt đã dùng sau khi thao tác thành công.
   */
  async incrementUsage(userId: string) {
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

  /**
   * Lấy profile của user.
   */
  async getProfile(userId: string) {
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

  /**
   * Reset subscription về free khi hết hạn.
   */
  async resetExpiredSubscription(userId: string) {
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

  /**
   * Lưu kết quả phân tích video vào DB.
   */
  async saveVideoAnalysis(userId: string, payload: {
    video_url: string;
    video_title: string | null;
    cover_image_url: string | null;
    analysis_result: any;
    viral_score: number;
  }) {
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

  /**
   * Lưu kịch bản đã tạo vào DB.
   */
  async saveGeneratedScript(userId: string, payload: {
    video_analysis_id: string | null;
    video_title: string | null;
    video_url: string | null;
    cover_image_url: string | null;
    script_content: string;
  }) {
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

  /**
   * Lấy video analysis gần nhất của user (dùng khi lưu script).
   */
  async getLatestVideoAnalysis(userId: string) {
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

  /**
   * Lưu kết quả kháng cáo vi phạm vào DB.
   */
  async saveViolationAppeal(userId: string, payload: {
    description: string | null;
    appeal_result: string;
  }) {
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

  /**
   * Lưu kết quả kiểm tra vi phạm kịch bản vào DB.
   */
  async saveScriptCheck(userId: string, payload: {
    script_content: string;
    check_result: string;
  }) {
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

  /**
   * Tạo affiliate code nếu chưa có.
   */
  async ensureAffiliateCode(userId: string, code: string) {
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

  async createPaymentTransaction(userId: string, payload: {
    reference_code: string;
    plan_tier: string;
    amount: number;
    expires_at: string;
  }) {
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

  async getPaymentTransactionStatus(userId: string, transactionId: string) {
    const supabase = this.supabaseService.getAdminClient();
    const { data, error } = await supabase
      .from('payment_transactions')
      .select('status')
      .eq('id', transactionId)
      .eq('user_id', userId)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async getHistory(userId: string, table: string, page: number, perPage: number) {
    const supabase = this.supabaseService.getAdminClient();
    const allowed = ['video_analyses', 'generated_scripts', 'script_checks', 'violation_appeals', 'upscaled_videos'];
    if (!allowed.includes(table)) throw new Error('Invalid table');
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;
    const { data, error, count } = await supabase
      .from(table as any)
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

  async getReferralStats(userId: string, dateFrom: string, dateTo: string, page: number, perPage: number) {
    const supabase = this.supabaseService.getAdminClient();

    // 1. Get code
    const { data: codeData } = await supabase
      .from('affiliate_codes')
      .select('code')
      .eq('user_id', userId)
      .maybeSingle();

    // 2. Counts
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

    // 3. Commissions
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

    // 4. Bank info
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

  async updateBankAccount(userId: string, payload: {
    bank_account_holder: string | null;
    bank_account_number: string | null;
    bank_name: string | null;
  }) {
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

  /**
   * Trừ một lượng credit tùy chỉnh dựa trên số phút xử lý video (làm tròn lên).
   */
  async deductCredits(userId: string, amount: number) {
    if (amount <= 0) return { success: true };
    const supabase = this.supabaseService.getAdminClient();

    // 1. Lấy profile hiện tại của user
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

    // A. Trừ monthly credits trước
    if (newMonthlyBalance > 0) {
      const deductFromMonthly = Math.min(newMonthlyBalance, remainingToDeduct);
      newMonthlyBalance -= deductFromMonthly;
      remainingToDeduct -= deductFromMonthly;
    }

    // B. Nếu vẫn còn dư, trừ sang purchased credits
    if (remainingToDeduct > 0 && newPurchasedBalance > 0) {
      const deductFromPurchased = Math.min(newPurchasedBalance, remainingToDeduct);
      newPurchasedBalance -= deductFromPurchased;
      remainingToDeduct -= deductFromPurchased;
    }

    // C. Nếu vẫn còn dư (Phương án B: Trừ kịch sàn về 0, không đi âm và không cộng dồn vào lượt miễn phí)
    if (remainingToDeduct > 0) {
      this.logger.log(`[deductCredits] User ${userId} ran out of credits. Capped at 0 (Option B - ignored remaining ${remainingToDeduct} credits).`);
      remainingToDeduct = 0;
    }

    // 2. Cập nhật lại vào database
    // NOTE: Không reset subscription_tier về 'free' khi monthly_credit_balance = 0.
    // Việc downgrade chỉ được thực hiện bởi resetExpiredSubscription() khi subscription_end_date đã qua.
    // Nếu cứ reset ở đây thì user mua gói tháng nhưng dùng 1 video sẽ bị hạ cấp về free.
    const updatePayload: any = {
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

  /**
   * Hoàn trả lại 1 credit cho user khi hủy tiến trình làm nét video
   */
  async refundCredit(userId: string) {
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
      const updatePayload: any = {
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
    } catch (e: any) {
      this.logger.error(`refundCredit exception for user ${userId}: ${e.message}`);
      return { success: false, error: e.message };
    }
  }
}
