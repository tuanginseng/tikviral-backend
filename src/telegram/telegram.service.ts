import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly botToken: string | undefined;
  private readonly chatId: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    this.chatId = this.configService.get<string>('TELEGRAM_CHAT_ID');

    if (!this.botToken || !this.chatId) {
      this.logger.warn(
        '[TelegramService] TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID chưa được cấu hình. Thông báo Telegram sẽ bị tắt.',
      );
    }
  }

  /**
   * Gửi thông báo lên Telegram với format Markdown đẹp.
   * Nếu thiếu cấu hình, chỉ log warning và bỏ qua (không crash app).
   */
  async sendAlert(title: string, body: string, emoji = '🔔'): Promise<void> {
    if (!this.botToken || !this.chatId) return;

    const now = new Date().toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      dateStyle: 'short',
      timeStyle: 'medium',
    });

    const message = [
      `${emoji} *${this.escapeMarkdown(title)}*`,
      ``,
      this.escapeMarkdown(body),
      ``,
      `🕐 _${now}_`,
    ].join('\n');

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: message,
          parse_mode: 'MarkdownV2',
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        this.logger.error(`[TelegramService] Gửi thông báo thất bại: ${err}`);
      } else {
        this.logger.log(`[TelegramService] Đã gửi alert: "${title}"`);
      }
    } catch (error: any) {
      this.logger.error(`[TelegramService] Lỗi kết nối Telegram: ${error.message}`);
    }
  }

  /** Escape các ký tự đặc biệt theo chuẩn MarkdownV2 của Telegram */
  private escapeMarkdown(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (char) => `\\${char}`);
  }

  /**
   * Gửi hóa đơn thành công: nếu có PDF thì gửi file, không thì gửi text.
   */
  async sendInvoiceAlert(params: {
    invoiceNo?: string;
    invoiceId?: string;
    planTier: string;
    amount: number;
    referenceCode: string;
    userEmail?: string;
    pdfBase64?: string;
    pdfUrl?: string;
  }): Promise<void> {
    const amountFormatted = params.amount.toLocaleString('vi-VN') + ' VND';
    const planLabel: Record<string, string> = {
      per_use_1: 'Gói 1 lượt',
      per_use_10: 'Gói 5 lượt',
      monthly_90: 'Gói Tháng 90 lượt (Pro)',
    };
    const caption = [
      `🧾 Hóa đơn điện tử xuất thành công`,
      ``,
      `📋 Số HĐ: ${params.invoiceNo || 'N/A'}`,
      `📦 Gói: ${planLabel[params.planTier] || params.planTier}`,
      `💰 Số tiền: ${amountFormatted}`,
      `🔑 Mã GD: ${params.referenceCode}`,
      `👤 Khách: ${params.userEmail}`,
      params.pdfUrl ? `🔗 Link Hóa đơn: ${params.pdfUrl}` : '',
      `🕐 ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
    ].filter(Boolean).join('\n');

    // Nếu có PDF → gửi file document
    if (params.pdfBase64 && this.botToken && this.chatId) {
      try {
        const pdfBuffer = Buffer.from(params.pdfBase64, 'base64');
        const fileName = `hoadon_${params.invoiceNo || params.referenceCode}.pdf`;

        const formData = new FormData();
        formData.append('chat_id', this.chatId);
        formData.append('caption', caption);
        formData.append('document', new Blob([pdfBuffer], { type: 'application/pdf' }), fileName);

        const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendDocument`, {
          method: 'POST',
          body: formData,
        });

        if (res.ok) {
          return;
        }
        this.logger.warn(`[TelegramService] Gửi PDF thất bại, fallback text`);
      } catch (err: any) {
        this.logger.warn(`[TelegramService] Lỗi gửi PDF: ${err.message}, fallback text`);
      }
    }

    // Fallback: gửi text nếu không có PDF
    await this.sendAlert('Hóa đơn điện tử xuất thành công', caption, '');
  }

  /**
   * Gửi thông báo khi xuất hóa đơn thất bại.
   */
  async sendInvoiceErrorAlert(params: {
    planTier: string;
    amount: number;
    referenceCode: string;
    errorMessage: string;
    userEmail?: string;
  }): Promise<void> {
    const amountFormatted = params.amount.toLocaleString('vi-VN') + ' VND';
    const body = [
      `📦 Gói: ${params.planTier}`,
      `💰 Số tiền: ${amountFormatted}`,
      `🔑 Mã GD: ${params.referenceCode}`,
      params.userEmail ? `👤 Khách: ${params.userEmail}` : '',
      `❗ Lỗi: ${params.errorMessage}`,
    ].filter(Boolean).join('\n');

    await this.sendAlert('Lỗi xuất hóa đơn điện tử', body, '❌');
  }
}
