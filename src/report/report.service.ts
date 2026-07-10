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
    // Lấy ngày hôm nay theo Vietnam time
    const nowVN = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }),
    );

    // Hôm qua
    const yesterdayVN = new Date(nowVN);
    yesterdayVN.setDate(yesterdayVN.getDate() - 1);

    // Lấy offset Vietnam (+7h = 420 phút)
    const vnOffsetMs = 7 * 60 * 60 * 1000;

    // Start: hôm qua 00:00:00 VN → UTC
    const startVN = new Date(yesterdayVN);
    startVN.setHours(0, 0, 0, 0);
    const startUTC = new Date(startVN.getTime() - vnOffsetMs);

    // End: hôm qua 23:59:59.999 VN → UTC (= hôm nay 00:00:00 VN)
    const endVN = new Date(yesterdayVN);
    endVN.setHours(23, 59, 59, 999);
    const endUTC = new Date(endVN.getTime() - vnOffsetMs);

    // Label để hiển thị
    const dateLabel = yesterdayVN.toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });

    return {
      startOfYesterday: startUTC.toISOString(),
      endOfYesterday: endUTC.toISOString(),
      dateLabel,
    };
  }
}
