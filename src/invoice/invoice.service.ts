import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';

export interface InvoiceItem {
  planTier: string;
  planName: string;
  unitPrice: number;
  quantity: number;
}

export interface CreatedInvoice {
  invoiceNo?: string;
  invoiceId?: string;
  transactionId: string;
  userId: string;
  amount: number;
  planTier: string;
  status: 'success' | 'failed';
  errorMessage?: string;
  pdfBase64?: string;  // PDF hóa đơn dạng base64
  pdfUrl?: string;     // URL lưu trữ file PDF
}

// Mapping plan_tier → thông tin hóa đơn (lấy từ CheckoutSheet.tsx)
// Đơn vị tính: Gói dịch vụ | Người bán: CÔNG TY TNHH TIKVIRAL - MST 0111537569
const PLAN_INVOICE_MAP: Record<string, { itemName: string; unitPrice: number }> = {
  per_use_10: { itemName: 'Gói 10 lượt phân tích Tikviral', unitPrice: 99000 },
  monthly_90: { itemName: 'Gói 90 lượt phân tích Tikviral', unitPrice: 199000 },
};

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  private readonly username: string | undefined;
  private readonly password: string | undefined;
  private readonly supplierTaxCode: string | undefined;
  private readonly templateCode: string | undefined;
  private readonly invoiceSeries: string | undefined;
  private readonly apiBaseUrl = 'https://api-vinvoice.viettel.vn/services/einvoiceapplication/api/InvoiceAPI/InvoiceWS';

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
  ) {
    this.username = this.configService.get<string>('VIETTEL_INVOICE_USERNAME');
    // Đọc trực tiếp từ process.env để tránh dotenv cắt mất ký tự # trong password
    this.password = process.env.VIETTEL_INVOICE_PASSWORD;
    this.supplierTaxCode = this.configService.get<string>('VIETTEL_INVOICE_SUPPLIER_TAX_CODE');
    this.templateCode = this.configService.get<string>('VIETTEL_INVOICE_TEMPLATE_CODE') || '1/770';
    this.invoiceSeries = this.configService.get<string>('VIETTEL_INVOICE_SERIES') || 'K23TXM';

    if (!this.username || !this.password || !this.supplierTaxCode) {
      this.logger.warn('[InvoiceService] Chưa cấu hình Viettel Invoice credentials. Tính năng xuất hóa đơn sẽ bị tắt.');
    }
  }

  /**
   * Xuất hóa đơn điện tử Viettel sau khi thanh toán thành công.
   * Lưu kết quả vào bảng `invoices` trong Supabase.
   */
  async createInvoice(transaction: {
    id: string;
    user_id: string;
    amount: number;
    plan_tier: string;
    reference_code: string;
  }): Promise<CreatedInvoice> {
    if (!this.username || !this.password || !this.supplierTaxCode) {
      this.logger.warn('[InvoiceService] Bỏ qua xuất hóa đơn — chưa cấu hình credentials.');
      return {
        status: 'failed',
        errorMessage: 'Viettel Invoice chưa được cấu hình',
        transactionId: transaction.id,
        userId: transaction.user_id,
        amount: transaction.amount,
        planTier: transaction.plan_tier,
      };
    }

    const planInfo = PLAN_INVOICE_MAP[transaction.plan_tier];
    if (!planInfo) {
      return {
        status: 'failed',
        errorMessage: `Không tìm thấy thông tin gói: ${transaction.plan_tier}`,
        transactionId: transaction.id,
        userId: transaction.user_id,
        amount: transaction.amount,
        planTier: transaction.plan_tier,
      };
    }

    const amount = transaction.amount;
    // Tính ngược giá chưa VAT: khách trả amount đã bao gồm VAT 8%
    // amountWithoutTax = round(amount / 1.08)
    // taxAmount = amount - amountWithoutTax
    const amountWithoutTax = Math.round(amount / 1.08);
    const taxAmount = amount - amountWithoutTax;

    const payload = {
      generalInvoiceInfo: {
        invoiceType: '1',
        templateCode: this.templateCode,
        invoiceSeries: this.invoiceSeries,
        currencyCode: 'VND',
        exchangeRate: 1,
        adjustmentType: '1',
        paymentStatus: true,
        cusGetInvoiceRight: true,
        invoiceIssuedDate: null,
        transactionUuid: transaction.reference_code,
      },
      buyerInfo: {
        buyerName: 'Khách lẻ không lấy hóa đơn',
        buyerLegalName: null,
        buyerTaxCode: null,
        buyerAddressLine: '',
        buyerPhoneNumber: null,
        buyerEmail: '',
        buyerIdNo: null,
        buyerIdType: null,
        buyerNotGetInvoice: '1',
      },
      payments: [{ paymentMethod: '2', paymentMethodName: 'CK' }],
      itemInfo: [
        {
          lineNumber: 1,
          selection: 1,
          itemCode: `TIKVIRAL_${transaction.plan_tier.toUpperCase()}`,
          itemName: planInfo.itemName,
          unitName: 'Gói',
          quantity: 1,
          unitPrice: amountWithoutTax,          // Giá chưa VAT
          itemTotalAmountWithoutTax: amountWithoutTax,
          itemTotalAmountAfterDiscount: amountWithoutTax,
          itemTotalAmountWithTax: amount,        // Tổng đã bao gồm VAT
          taxPercentage: 8,
          taxAmount: taxAmount,
          discount: null,
          itemDiscount: null,
          itemNote: null,
          isIncreaseItem: null,
        },
      ],
      taxBreakdowns: [
        {
          taxPercentage: 8,
          taxableAmount: amountWithoutTax,
          taxAmount: taxAmount,
        },
      ],
      summarizeInfo: {
        sumOfTotalLineAmountWithoutTax: amountWithoutTax,
        totalAmountAfterDiscount: amountWithoutTax,
        totalAmountWithoutTax: amountWithoutTax,
        totalTaxAmount: taxAmount,
        totalAmountWithTax: amount,
        totalAmountWithTaxInWords: null,
        discountAmount: 0,
      },
      metadata: [],
    };

    let result: CreatedInvoice = {
      transactionId: transaction.id,
      userId: transaction.user_id,
      amount,
      planTier: transaction.plan_tier,
      status: 'failed',
    };

    try {
      const credentials = Buffer.from(`${this.username}:${this.password}`).toString('base64');
      const url = `${this.apiBaseUrl}/createInvoice/${this.supplierTaxCode}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${credentials}`,
        },
        body: JSON.stringify(payload),
      });

      const responseData = await response.json() as any;

      if (!response.ok || responseData.errorCode) {
        const code = responseData.errorCode ? `[${responseData.errorCode}] ` : `[HTTP ${response.status}] `;
        const detail = responseData.description || responseData.message || JSON.stringify(responseData);
        const errMsg = `${code}${detail}`;
        result.errorMessage = errMsg;
      } else {
        result.status = 'success';
        result.invoiceNo = responseData.result?.invoiceNo || responseData.invoiceNo;
        result.invoiceId = responseData.result?.invoiceId || responseData.invoiceId;

        // Lấy PDF ngay sau khi tạo hóa đơn thành công
        if (result.invoiceNo) {
          result.pdfBase64 = await this.getInvoicePdfBase64(result.invoiceNo);
          
          if (result.pdfBase64) {
            const pdfBuffer = Buffer.from(result.pdfBase64, 'base64');
            const admin = this.supabaseService.getAdminClient();
            const filePath = `${transaction.reference_code}.pdf`;
            const { data: uploadData, error: uploadError } = await admin.storage.from('invoices').upload(filePath, pdfBuffer, {
              contentType: 'application/pdf',
              upsert: true,
            });

            if (uploadError) {
              this.logger.error(`[InvoiceService] Lỗi upload PDF lên storage: ${uploadError.message}`);
            } else if (uploadData) {
              const { data: publicUrlData } = admin.storage.from('invoices').getPublicUrl(filePath);
              result.pdfUrl = publicUrlData.publicUrl;
            }
          }
        }
      }
    } catch (error: any) {
      result.errorMessage = error.message;
    }

    // Lưu kết quả vào DB dù thành công hay thất bại
    await this.saveInvoiceToDb(result, transaction.reference_code);

    return result;
  }

  /**
   * Lấy file PDF hóa đơn dạng base64 từ Viettel
   */
  async getInvoicePdfBase64(invoiceNo: string): Promise<string | undefined> {
    try {
      const credentials = Buffer.from(`${this.username}:${this.password}`).toString('base64');
      const url = 'https://api-vinvoice.viettel.vn/services/einvoiceapplication/api/InvoiceAPI/InvoiceUtilsWS/getInvoiceRepresentationFile';

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${credentials}`,
        },
        body: JSON.stringify({
          supplierTaxCode: this.supplierTaxCode,
          invoiceNo,
          templateCode: this.templateCode,
          fileType: 'PDF',
        }),
      });

      const data = await response.json() as any;

      // Viettel PDF API dùng errorCode=200 để báo THÀNH CÔNG (khác với createInvoice dùng null)
      const isSuccess = response.ok && (!data.errorCode || data.errorCode === 200 || data.errorCode === '200');

      if (!isSuccess) {
        const errMsg = data.description || data.message || data.errorCode || JSON.stringify(data);
        return undefined;
      }

      // Viettel trả về field 'fileToBytes' hoặc 'file' hoặc 'result' dạng base64
      const base64 = data.fileToBytes || data.file || data.result?.fileToBytes || data.result?.file || data.result;
      return base64;
    } catch (error: any) {
      return undefined;
    }
  }

  private async saveInvoiceToDb(invoice: CreatedInvoice, referenceCode: string): Promise<void> {
    const admin = this.supabaseService.getAdminClient();
    const { error } = await admin.from('invoices').insert({
      transaction_id: invoice.transactionId,
      user_id: invoice.userId,
      amount: invoice.amount,
      plan_tier: invoice.planTier,
      reference_code: referenceCode,
      invoice_no: invoice.invoiceNo || null,
      invoice_id: invoice.invoiceId || null,
      status: invoice.status,
      error_message: invoice.errorMessage || null,
      pdf_url: invoice.pdfUrl || null,
    });

    if (error) {
      this.logger.error(`[InvoiceService] Lỗi lưu hóa đơn vào DB: ${error.message}`);
    }
  }

  /**
   * Tạo hóa đơn nháp trên Viettel (admin).
   * Dùng API createOrUpdateInvoiceDraft — không phát hành chính thức.
   */
  async createInvoiceDraft(planTier: string): Promise<{ success: boolean; data?: any; error?: string; pdfBase64?: string }> {
    const planInfo = PLAN_INVOICE_MAP[planTier];
    if (!planInfo) {
      return { success: false, error: `Không tìm thấy gói: ${planTier}` };
    }

    const amount = planInfo.unitPrice;
    const amountWithoutTax = Math.round(amount / 1.08);
    const taxAmount = amount - amountWithoutTax;
    const transactionUuid = `DRAFT_${planTier.toUpperCase()}_${Date.now()}`;

    const payload = {
      generalInvoiceInfo: {
        invoiceType: '1',
        templateCode: this.templateCode,
        invoiceSeries: this.invoiceSeries,
        currencyCode: 'VND',
        exchangeRate: 1,
        adjustmentType: '1',
        paymentStatus: true,
        cusGetInvoiceRight: true,
        invoiceIssuedDate: null,
        transactionUuid,
      },
      buyerInfo: {
        buyerName: 'Khách lẻ không lấy hóa đơn',
        buyerLegalName: null,
        buyerTaxCode: null,
        buyerAddressLine: '',
        buyerPhoneNumber: null,
        buyerEmail: '',
        buyerIdNo: null,
        buyerIdType: null,
        buyerNotGetInvoice: '1',
      },
      payments: [{ paymentMethod: '2', paymentMethodName: 'CK' }],
      itemInfo: [
        {
          lineNumber: 1,
          selection: 1,
          itemCode: `TIKVIRAL_${planTier.toUpperCase()}`,
          itemName: planInfo.itemName,
          unitName: 'Gói',
          quantity: 1,
          unitPrice: amountWithoutTax,
          itemTotalAmountWithoutTax: amountWithoutTax,
          itemTotalAmountAfterDiscount: amountWithoutTax,
          itemTotalAmountWithTax: amount,
          taxPercentage: 8,
          taxAmount,
          discount: null,
          itemDiscount: null,
          itemNote: null,
          isIncreaseItem: null,
        },
      ],
      taxBreakdowns: [{ taxPercentage: 8, taxableAmount: amountWithoutTax, taxAmount }],
      summarizeInfo: {
        sumOfTotalLineAmountWithoutTax: amountWithoutTax,
        totalAmountAfterDiscount: amountWithoutTax,
        totalAmountWithoutTax: amountWithoutTax,
        totalTaxAmount: taxAmount,
        totalAmountWithTax: amount,
        totalAmountWithTaxInWords: null,
        discountAmount: 0,
      },
      metadata: [],
    };

    try {
      const credentials = Buffer.from(`${this.username}:${this.password}`).toString('base64');
      // createOrUpdateInvoiceDraft nằm dưới InvoiceWS (cùng với createInvoice)
      const draftUrl = `${this.apiBaseUrl}/createOrUpdateInvoiceDraft/${this.supplierTaxCode}`;

      const draftResponse = await fetch(draftUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${credentials}` },
        body: JSON.stringify(payload),
      });

      const draftData = await draftResponse.json() as any;

      if (!draftResponse.ok || (draftData.errorCode && draftData.errorCode !== 200)) {
        const errMsg = draftData.description || draftData.message || JSON.stringify(draftData);
        return { success: false, error: errMsg };
      }

      // createInvoiceDraftPreview nằm dưới InvoiceUtilsWS
      const previewUrl = `${this.apiBaseUrl.replace('/InvoiceWS', '')}/InvoiceUtilsWS/createInvoiceDraftPreview/${this.supplierTaxCode}`;
      let pdfBase64: string | undefined;

      try {
        const previewResponse = await fetch(previewUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${credentials}` },
          body: JSON.stringify(payload),
        });

        const previewData = await previewResponse.json() as any;
        const isPreviewOk = previewResponse.ok && (!previewData.errorCode || previewData.errorCode === 200 || previewData.errorCode === '200');

        if (isPreviewOk) {
          pdfBase64 = previewData.fileToBytes || previewData.file || previewData.result?.fileToBytes || previewData.result;
        } else {
          this.logger.warn(`[InvoiceService] Lấy PDF preview thất bại: ${JSON.stringify(previewData)}`);
        }
      } catch (previewErr: any) {
        this.logger.warn(`[InvoiceService] Lỗi kết nối preview: ${previewErr.message}`);
      }

      return { success: true, data: draftData, pdfBase64 };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Lấy danh sách hóa đơn từ DB (admin).
   */
  async listInvoices(params: { page?: number; limit?: number; status?: string; month?: string }): Promise<{ data: any[]; count: number }> {
    const admin = this.supabaseService.getAdminClient();
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = admin
      .from('invoices')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (params.status && params.status !== 'all') {
      query = query.eq('status', params.status);
    }

    if (params.month && params.month !== 'all') {
      // month is in 'YYYY-MM' format
      const startDate = new Date(`${params.month}-01T00:00:00.000Z`);
      const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 1);
      query = query.gte('created_at', startDate.toISOString()).lt('created_at', endDate.toISOString());
    }

    const { data, error, count } = await query;
    if (error) {
      return { data: [], count: 0 };
    }
    return { data: data ?? [], count: count ?? 0 };
  }
}
