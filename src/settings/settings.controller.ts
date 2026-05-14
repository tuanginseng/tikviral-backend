import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards, HttpException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { AdminService } from './admin.service';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly adminService: AdminService,
  ) {}

  @Post('manage-admin-settings')
  @UseGuards(SupabaseAuthGuard)
  @HttpCode(HttpStatus.OK)
  async manageAdminSettings(@Body() body: any) {
    return this.settingsService.manageSettings(body);
  }

  /** POST /settings/user-stats — Thống kê người dùng (admin only) */
  @Post('user-stats')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async getUserStats() {
    try {
      return await this.adminService.getUserStats();
    } catch (error: any) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** POST /settings/payment-transactions — Lịch sử thanh toán (admin only) */
  @Post('payment-transactions')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async getPaymentTransactions(@Body() body: any) {
    try {
      return await this.adminService.getPaymentTransactions({
        page: body.page ?? 1,
        limit: body.limit ?? 20,
        status: body.status,
        dateFrom: body.dateFrom,
        dateTo: body.dateTo,
      });
    } catch (error: any) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** POST /settings/all-payment-transactions — Xuất toàn bộ giao dịch (admin only) */
  @Post('all-payment-transactions')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async getAllPaymentTransactions(@Body() body: any) {
    try {
      return await this.adminService.getAllPaymentTransactions({
        status: body.status,
        dateFrom: body.dateFrom,
        dateTo: body.dateTo,
      });
    } catch (error: any) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
