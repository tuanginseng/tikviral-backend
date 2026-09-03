import {
  Controller, Post, Body, HttpCode, HttpStatus,
  UseGuards, HttpException, Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { DiscountService } from './discount.service';
import { AdminGuard } from '../auth/admin.guard';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

@Controller('discount')
export class DiscountController {
  constructor(private readonly discountService: DiscountService) {}

  /**
   * POST /discount/validate
   * Người dùng đã login kiểm tra mã giảm giá trước khi thanh toán.
   * userId lấy từ request.user (inject bởi SupabaseAuthGuard).
   */
  @Post('validate')
  @UseGuards(SupabaseAuthGuard)
  @HttpCode(HttpStatus.OK)
  async validateCode(
    @Body() body: { code: string; originalAmount: number },
    @Req() req: Request & { user?: any },
  ) {
    const userId = req.user?.id;
    if (!body.code || !body.originalAmount || !userId) {
      throw new HttpException('Thiếu thông tin: code hoặc originalAmount', HttpStatus.BAD_REQUEST);
    }

    const result = await this.discountService.validateCode(body.code, userId, body.originalAmount);
    return result;
  }

  /**
   * POST /discount/notifications
   * Lấy thông báo khuyến mãi hiển thị trong checkout (public).
   */
  @Post('notifications')
  @HttpCode(HttpStatus.OK)
  async getNotifications() {
    return this.discountService.getActiveNotifications();
  }

  // ─── ADMIN ENDPOINTS ──────────────────────────────────────────────────────────

  /** POST /discount/admin/list */
  @Post('admin/list')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async listCodes(@Body() body: { page?: number; limit?: number; isActive?: boolean }) {
    return this.discountService.listCodes({
      page: body.page,
      limit: body.limit,
      isActive: body.isActive,
    });
  }

  /** POST /discount/admin/create */
  @Post('admin/create')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async createCode(@Body() body: any) {
    const result = await this.discountService.createCode({
      code: body.code,
      description: body.description,
      discountType: body.discountType,
      discountValue: body.discountValue,
      maxUses: body.maxUses,
      expiresAt: body.expiresAt,
      notificationMessage: body.notificationMessage,
      popupImageUrl: body.popupImageUrl,
      popupTitle: body.popupTitle,
      popupBody: body.popupBody,
      popupCtaText: body.popupCtaText,
      popupCtaUrl: body.popupCtaUrl,
    });

    if (!result.success) {
      throw new HttpException(result.error || 'Lỗi tạo mã giảm giá', HttpStatus.BAD_REQUEST);
    }
    return result;
  }

  /** POST /discount/admin/update */
  @Post('admin/update')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async updateCode(@Body() body: any) {
    if (!body.id) {
      throw new HttpException('Thiếu id', HttpStatus.BAD_REQUEST);
    }
    const result = await this.discountService.updateCode(body.id, {
      code: body.code,
      description: body.description,
      discountType: body.discountType,
      discountValue: body.discountValue,
      maxUses: body.maxUses,
      expiresAt: body.expiresAt,
      isActive: body.isActive,
      notificationMessage: body.notificationMessage,
      popupImageUrl: body.popupImageUrl,
      popupTitle: body.popupTitle,
      popupBody: body.popupBody,
      popupCtaText: body.popupCtaText,
      popupCtaUrl: body.popupCtaUrl,
    });

    if (!result.success) {
      throw new HttpException(result.error || 'Lỗi cập nhật mã giảm giá', HttpStatus.BAD_REQUEST);
    }
    return result;
  }

  /** POST /discount/admin/delete */
  @Post('admin/delete')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async deleteCode(@Body() body: { id: string }) {
    if (!body.id) {
      throw new HttpException('Thiếu id', HttpStatus.BAD_REQUEST);
    }
    const result = await this.discountService.deleteCode(body.id);
    if (!result.success) {
      throw new HttpException(result.error || 'Lỗi xóa mã giảm giá', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    return result;
  }
}
