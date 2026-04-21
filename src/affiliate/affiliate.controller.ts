import { Controller, Post, Body, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { AffiliateService } from './affiliate.service';
import { AdminGuard } from '../auth/admin.guard';

@Controller('affiliate')
export class AffiliateController {
  constructor(private readonly affiliateService: AffiliateService) {}

  @Post('sync-kalodata-products')
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
  @HttpCode(HttpStatus.OK)
  async recordReferral(@Req() req: any, @Body() body: any) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : '';
    return this.affiliateService.recordReferral(token, body.ref_code);
  }

  @Post('upload-affiliate-image')
  @HttpCode(HttpStatus.OK)
  async uploadAffiliateImage(@Body() body: any) {
    return this.affiliateService.uploadAffiliateImage(body.imageData, body.mimeType, body.fileName);
  }
}
