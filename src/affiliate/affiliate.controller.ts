import { Controller, Post, Body, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { AffiliateService } from './affiliate.service';
import { AdminGuard } from '../auth/admin.guard';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

@Controller('affiliate')
export class AffiliateController {
  constructor(private readonly affiliateService: AffiliateService) {}

  @Post('sync-kalodata-products')
  @UseGuards(SupabaseAuthGuard)
  @HttpCode(HttpStatus.OK)
  async syncKalodataProducts(@Body() body: any) {
    return this.affiliateService.syncKalodataProducts(body.kalodataCookie);
  }

  @Post('manage-affiliate-products')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async manageAffiliateProducts(@Body() body: any) {
    return this.affiliateService.manageProducts(body);
  }

  @Post('admin-affiliate-commissions')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async adminAffiliateCommissions(@Body() body: any) {
    return this.affiliateService.manageCommissions(body);
  }

  @Post('record-referral')
  @UseGuards(SupabaseAuthGuard)
  @HttpCode(HttpStatus.OK)
  async recordReferral(@Req() req: any, @Body() body: any) {
    // We already have the user from SupabaseAuthGuard
    return this.affiliateService.recordReferralByUser(req.user, body.ref_code);
  }

  @Post('upload-affiliate-image')
  @UseGuards(SupabaseAuthGuard)
  @HttpCode(HttpStatus.OK)
  async uploadAffiliateImage(@Body() body: any) {
    return this.affiliateService.uploadAffiliateImage(body.imageData, body.mimeType, body.fileName);
  }
}
