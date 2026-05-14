import { Controller, Post, Body, Req, UseGuards, HttpCode, HttpStatus, HttpException } from '@nestjs/common';
import { UsageService } from './usage.service';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

@Controller('usage')
@UseGuards(SupabaseAuthGuard)
export class UsageController {
  constructor(private readonly usageService: UsageService) { }

  /** POST /usage/check — Kiểm tra số lượt còn lại */
  @Post('check')
  @HttpCode(HttpStatus.OK)
  async checkUsage(@Req() req: any) {
    try {
      return await this.usageService.checkUsage(req.user.id);
    } catch (error: any) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** POST /usage/increment — Tăng số lượt đã dùng */
  @Post('increment')
  @HttpCode(HttpStatus.OK)
  async incrementUsage(@Req() req: any) {
    try {
      return await this.usageService.incrementUsage(req.user.id);
    } catch (error: any) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** POST /usage/profile — Lấy profile user */
  @Post('profile')
  @HttpCode(HttpStatus.OK)
  async getProfile(@Req() req: any) {
    try {
      return await this.usageService.getProfile(req.user.id);
    } catch (error: any) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** POST /usage/reset-subscription — Reset subscription hết hạn */
  @Post('reset-subscription')
  @HttpCode(HttpStatus.OK)
  async resetSubscription(@Req() req: any) {
    try {
      return await this.usageService.resetExpiredSubscription(req.user.id);
    } catch (error: any) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** POST /usage/save-video-analysis — Lưu kết quả phân tích video */
  @Post('save-video-analysis')
  @HttpCode(HttpStatus.OK)
  async saveVideoAnalysis(@Req() req: any, @Body() body: any) {
    try {
      return await this.usageService.saveVideoAnalysis(req.user.id, {
        video_url: body.video_url,
        video_title: body.video_title ?? null,
        cover_image_url: body.cover_image_url ?? null,
        analysis_result: body.analysis_result,
        viral_score: body.viral_score,
      });
    } catch (error: any) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** POST /usage/save-generated-script — Lưu kịch bản đã tạo */
  @Post('save-generated-script')
  @HttpCode(HttpStatus.OK)
  async saveGeneratedScript(@Req() req: any, @Body() body: any) {
    try {
      // Tự động lấy video analysis gần nhất nếu FE không truyền
      let videoAnalysisId = body.video_analysis_id ?? null;
      let videoTitle = body.video_title ?? null;
      let videoUrl = body.video_url ?? null;
      let coverImageUrl = body.cover_image_url ?? null;

      if (!videoAnalysisId) {
        const latest = await this.usageService.getLatestVideoAnalysis(req.user.id);
        if (latest) {
          videoAnalysisId = latest.id;
          videoTitle = latest.video_title;
          videoUrl = latest.video_url;
          coverImageUrl = latest.cover_image_url;
        }
      }

      return await this.usageService.saveGeneratedScript(req.user.id, {
        video_analysis_id: videoAnalysisId,
        video_title: videoTitle,
        video_url: videoUrl,
        cover_image_url: coverImageUrl,
        script_content: body.script_content,
      });
    } catch (error: any) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** POST /usage/save-violation-appeal — Lưu kết quả kháng cáo vi phạm */
  @Post('save-violation-appeal')
  @HttpCode(HttpStatus.OK)
  async saveViolationAppeal(@Req() req: any, @Body() body: any) {
    try {
      return await this.usageService.saveViolationAppeal(req.user.id, {
        description: body.description ?? null,
        appeal_result: body.appeal_result,
      });
    } catch (error: any) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** POST /usage/save-script-check — Lưu kết quả kiểm tra vi phạm kịch bản */
  @Post('save-script-check')
  @HttpCode(HttpStatus.OK)
  async saveScriptCheck(@Req() req: any, @Body() body: any) {
    try {
      return await this.usageService.saveScriptCheck(req.user.id, {
        script_content: body.script_content,
        check_result: body.check_result,
      });
    } catch (error: any) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** POST /usage/ensure-affiliate-code — Tạo affiliate code nếu chưa có */
  @Post('ensure-affiliate-code')
  @HttpCode(HttpStatus.OK)
  async ensureAffiliateCode(@Req() req: any, @Body() body: { code: string }) {
    try {
      return await this.usageService.ensureAffiliateCode(req.user.id, body.code);
    } catch (error: any) {
      throw new HttpException(
        { message: error.message, code: error.code },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }
}

