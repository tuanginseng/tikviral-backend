import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

@Controller('gemini')
export class GeminiController {
  constructor(private readonly geminiService: GeminiService) {}

  /** Không cần auth - chỉ dùng apiKeyToTest do client tự cung cấp */
  @Post('proxy')
  @HttpCode(HttpStatus.OK)
  async proxyRequest(@Body() body: any) {
    return this.geminiService.proxyRequest(body);
  }

  @Post('manage-keys')
  @UseGuards(SupabaseAuthGuard)
  @HttpCode(HttpStatus.OK)
  async manageKeys(@Body() body: any) {
    const { action, ...payload } = body;
    return this.geminiService.manageApiKeys(action, payload);
  }

  @Post('generate-blog')
  @UseGuards(SupabaseAuthGuard)
  @HttpCode(HttpStatus.OK)
  async generateBlogContent(@Body() body: any) {
    return this.geminiService.generateBlogContent(body.topic, body.generateImages);
  }

  /**
   * Endpoint bảo mật tuyệt đối - frontend chỉ gửi data thô + tên task.
   * Prompt được build hoàn toàn server-side, không bao giờ lộ ra ngoài.
   */
  @Post('task')
  @UseGuards(SupabaseAuthGuard)
  @HttpCode(HttpStatus.OK)
  async executeTask(@Body() body: any) {
    return this.geminiService.executeTask(body);
  }
}
