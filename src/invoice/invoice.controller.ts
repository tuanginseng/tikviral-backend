import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards, HttpException } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { AdminGuard } from '../auth/admin.guard';

@Controller('invoice')
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  /** POST /invoice/list — Danh sách hóa đơn (admin only) */
  @Post('list')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async listInvoices(@Body() body: any) {
    try {
      return await this.invoiceService.listInvoices({
        page: body.page ?? 1,
        limit: body.limit ?? 20,
        status: body.status,
        month: body.month,
      });
    } catch (error: any) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** POST /invoice/create-draft — Tạo hóa đơn nháp Viettel (admin only) */
  @Post('create-draft')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async createInvoiceDraft(@Body() body: { planTier: string }) {
    try {
      const result = await this.invoiceService.createInvoiceDraft(body.planTier);
      if (!result.success) {
        throw new HttpException(result.error || 'Lỗi tạo hóa đơn nháp', HttpStatus.BAD_REQUEST);
      }
      return result;
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
