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
      .update({ subscription_tier: 'free', subscription_end_date: null })
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
}

