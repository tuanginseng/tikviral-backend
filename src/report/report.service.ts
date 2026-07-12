import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../supabase/supabase.service';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly telegramService: TelegramService,
  ) { }

  /**
   * Gửi báo cáo tổng hợp hàng ngày lúc 6:00 sáng giờ Việt Nam.
   * Báo cáo bao gồm số liệu của ngày hôm trước.
   */
  @Cron('0 6 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async sendDailyReport(): Promise<void> {

    try {
      const { startOfYesterday, endOfYesterday, dateLabel } =
        this.getYesterdayRange();

      const supabase = this.supabaseService.getAdminClient();

      // 1. Tổng số người đăng ký mới
      const { count: newUsers } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', startOfYesterday)
        .lt('created_at', endOfYesterday);

      // 2. Tổng số người đã thanh toán (distinct users)
      const { data: paidTransactions, count: totalPayments } = await supabase
        .from('payment_transactions')
        .select('user_id, amount', { count: 'exact' })
        .eq('status', 'completed')
        .gte('completed_at', startOfYesterday)
        .lt('completed_at', endOfYesterday);

      // Đếm distinct users đã thanh toán
      const distinctPayers = new Set(
        (paidTransactions || []).map((t) => t.user_id),
      ).size;

      // 3. Tổng doanh thu
      const totalRevenue = (paidTransactions || []).reduce(
        (sum, t) => sum + Number(t.amount || 0),
        0,
      );

      // 4. Tổng hóa đơn đã xuất (thành công + thất bại)
      const { data: invoices } = await supabase
        .from('invoices')
        .select('status')
        .gte('created_at', startOfYesterday)
        .lt('created_at', endOfYesterday);

      const successInvoices = (invoices || []).filter(
        (i) => i.status === 'success',
      ).length;
      const failedInvoices = (invoices || []).filter(
        (i) => i.status === 'failed',
      ).length;
      const totalInvoices = successInvoices + failedInvoices;

      // Format message
      const revenueFormatted = totalRevenue.toLocaleString('vi-VN') + ' VND';

      const body = [
        `📅 Ngày báo cáo: ${dateLabel}`,
        ``,
        `👤 Người đăng ký mới: ${newUsers ?? 0}`,
        `💳 Người đã thanh toán: ${distinctPayers} (${totalPayments ?? 0} giao dịch)`,
        `💰 Tổng doanh thu: ${revenueFormatted}`,
        `🧾 Hóa đơn đã xuất: ${totalInvoices} (✅ ${successInvoices} thành công · ❌ ${failedInvoices} thất bại)`,
      ].join('\n');

      await this.telegramService.sendAlert(
        '📊 Báo cáo doanh thu hàng ngày',
        body,
        '📊',
      );

    } catch (error: any) {
      this.logger.error(
        `[ReportService] Lỗi khi gửi báo cáo: ${error.message}`,
      );
    }
  }

  /**
   * Tính range của ngày hôm qua theo timezone Asia/Ho_Chi_Minh.
   * Trả về ISO strings UTC để query Supabase.
   */
  private getYesterdayRange(): {
    startOfYesterday: string;
    endOfYesterday: string;
    dateLabel: string;
  } {
    const now = new Date();
    
    // Lấy YYYY-MM-DD của ngày hôm nay theo giờ VN
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    
    const todayStr = formatter.format(now);
    const [year, month, day] = todayStr.split('-').map(Number);
    
    // Tính mốc 00:00:00 của ngày hôm nay (VN) quy ra mili-giây UTC
    // Date.UTC(year, month - 1, day) là 0h UTC, trừ đi 7h sẽ ra 0h VN
    const startOfTodayVN_In_UTC = Date.UTC(year, month - 1, day) - 7 * 60 * 60 * 1000;
    
    // Hôm qua sẽ lùi lại 24h
    const startOfYesterdayUTC = new Date(startOfTodayVN_In_UTC - 24 * 60 * 60 * 1000);
    const endOfYesterdayUTC = new Date(startOfTodayVN_In_UTC - 1);
    
    // Format label ngày báo cáo theo giờ VN
    const dateLabel = new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(startOfYesterdayUTC);

    return {
      startOfYesterday: startOfYesterdayUTC.toISOString(),
      endOfYesterday: endOfYesterdayUTC.toISOString(),
      dateLabel,
    };
  }
}
