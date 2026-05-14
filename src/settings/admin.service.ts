import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Thống kê số lượng người dùng: tổng, hôm nay, 7 ngày, 30 ngày
   */
  async getUserStats() {
    const supabase = this.supabaseService.getAdminClient();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const last7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [total, todayCount, last7Count, last30Count] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', today),
      supabase.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', last7),
      supabase.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', last30),
    ]);

    if (total.error) throw new Error(total.error.message);

    return {
      total: total.count ?? 0,
      today: todayCount.count ?? 0,
      last7Days: last7Count.count ?? 0,
      last30Days: last30Count.count ?? 0,
    };
  }

  /**
   * Lịch sử giao dịch thanh toán (có phân trang + lọc)
   */
  async getPaymentTransactions(params: {
    page: number;
    limit: number;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const supabase = this.supabaseService.getAdminClient();
    const { page, limit, status, dateFrom, dateTo } = params;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from('payment_transactions')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (status && status !== 'all') query = query.eq('status', status);
    if (dateFrom) query = query.gte('created_at', dateFrom);
    if (dateTo) query = query.lte('created_at', dateTo);

    const { data: transactions, error, count } = await query;
    if (error) throw new Error(error.message);

    // Lấy profiles của các user trong danh sách
    const userIds = (transactions ?? []).map((t: any) => t.user_id).filter(Boolean);
    let profilesMap: Record<string, any> = {};

    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, email, full_name')
        .in('id', userIds);
      profilesMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]));
    }

    const merged = (transactions ?? []).map((t: any) => ({
      ...t,
      profiles: profilesMap[t.user_id] ?? { email: 'N/A', full_name: 'N/A' },
    }));

    return { data: merged, count: count ?? 0 };
  }

  /**
   * Xuất toàn bộ giao dịch (không phân trang, dùng cho Excel export)
   */
  async getAllPaymentTransactions(params: {
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const supabase = this.supabaseService.getAdminClient();
    const { status, dateFrom, dateTo } = params;

    let query = supabase
      .from('payment_transactions')
      .select('*')
      .order('created_at', { ascending: false });

    if (status && status !== 'all') query = query.eq('status', status);
    if (dateFrom) query = query.gte('created_at', dateFrom);
    if (dateTo) query = query.lte('created_at', dateTo);

    const { data: transactions, error } = await query;
    if (error) throw new Error(error.message);

    const userIds = (transactions ?? []).map((t: any) => t.user_id).filter(Boolean);
    let profilesMap: Record<string, any> = {};

    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, email, full_name')
        .in('id', userIds);
      profilesMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]));
    }

    return (transactions ?? []).map((t: any) => ({
      ...t,
      profiles: profilesMap[t.user_id] ?? { email: 'N/A', full_name: 'N/A' },
    }));
  }
}
