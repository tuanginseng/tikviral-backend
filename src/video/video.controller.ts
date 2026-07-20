import { Controller, Post, Body, HttpCode, HttpStatus, Get, Query, Res, Req, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';

import type { Response } from 'express';
import { VideoService } from './video.service';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('video')
export class VideoController {
  constructor(private readonly videoService: VideoService) { }

  /**
   * Securely upload input video to Cloudflare R2 on behalf of the client
   */
  @Post('upload-r2')
  @UseGuards(SupabaseAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.OK)
  async uploadFileR2(
    @Req() req: any,
    @UploadedFile() file: any,
  ) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn file video.');
    }
    const userId = req.user.id;
    const uploadName = `${userId}/${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '')}`;
    const r2Url = await this.videoService.uploadToR2(uploadName, file.buffer, file.mimetype);
    return { success: true, url: r2Url };
  }

  /**
   * Compress video server-side using FFmpeg, upload to R2, return URL.
   * FE dùng URL này để gửi cho Gemini thay vì base64 blob.
   */
  @Post('compress')
  @UseGuards(SupabaseAuthGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 500 * 1024 * 1024 } }))
  @HttpCode(HttpStatus.OK)
  async compressVideo(
    @Req() req: any,
    @UploadedFile() file: any,
  ) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn file video.');
    }
    const userId = req.user?.id || 'anonymous';
    return this.videoService.compressVideoBuffer(file.buffer, file.mimetype, userId);
  }



  /**
   * Download video tu URL (TikTok CDN), nen bang FFmpeg, upload R2.
   * FE dung URL nay thay cho URL CDN co the expire.
   */
  @Post('compress-from-url')
  @UseGuards(SupabaseAuthGuard)
  @HttpCode(HttpStatus.OK)
  async compressVideoFromUrl(
    @Req() req: any,
    @Body() body: { videoUrl: string },
  ) {
    if (!body?.videoUrl) {
      throw new BadRequestException('videoUrl la bat buoc.');
    }
    const userId = req.user?.id || 'anonymous';
    return this.videoService.compressVideoFromUrl(body.videoUrl, userId);
  }



  /**
   * Xoa video tam tren R2 sau khi Gemini phan tich xong.
   * FE goi sau khi nhan ket qua phan tich thanh cong.
   */
  @Post('r2-cleanup')
  @UseGuards(SupabaseAuthGuard)
  @HttpCode(HttpStatus.OK)
  async cleanupR2Video(
    @Req() req: any,
    @Body() body: { url: string },
  ) {
    if (!body?.url) {
      throw new BadRequestException('url la bat buoc.');
    }
    // Fire-and-forget: khong can await, tra ve 200 ngay
    this.videoService.deleteFromR2(body.url).catch((err) => {
      console.warn('[R2Cleanup] Error:', err?.message);
    });
    return { success: true };
  }

  /**
   * Upscale video (requires auth & credits)
   */
  @Post('upscale')
  @UseGuards(SupabaseAuthGuard)
  @HttpCode(HttpStatus.OK)
  async upscaleVideo(@Req() req: any, @Body() body: { video_url: string, file_name?: string }) {
    return this.videoService.upscaleVideo(req.user.id, body.video_url, body.file_name);
  }


  /**
   * Cancel an ongoing upscale video process (requires auth)
   */
  @Post('cancel')
  @UseGuards(SupabaseAuthGuard)
  @HttpCode(HttpStatus.OK)
  async cancelUpscale(@Req() req: any, @Body() body: { id: string }) {
    return this.videoService.cancelUpscale(req.user.id, body.id);
  }

  /**
   * Download video TikTok server-side.
   * Frontend chỉ gửi URL, nhận về base64 video + metrics.
   * RapidAPI key & logic ẩn hoàn toàn trên server.
   */
  @Post('download')
  @HttpCode(HttpStatus.OK)
  async downloadVideo(@Body() body: { url: string }) {
    return this.videoService.downloadVideo(body.url);
  }

  @Get('proxy')
  async proxyMedia(@Query('url') url: string, @Res() res: Response) {
    if (!url) {
      return res.status(HttpStatus.BAD_REQUEST).send('URL is required');
    }
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.tiktok.com/',
        }
      });

      if (!response.ok) {
        return res.status(response.status).send(response.statusText);
      }

      res.set({
        'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
        'Content-Length': response.headers.get('content-length'),
        'Cache-Control': 'public, max-age=31536000',
        'Access-Control-Allow-Origin': '*',
      });

      // Stream the response body
      if (response.body) {
        // @ts-ignore
        for await (const chunk of response.body) {
          res.write(chunk);
        }
        res.end();
      } else {
        res.end();
      }
    } catch (error) {
      // console.error('Proxy error:', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).send('Proxy error');
    }
  }

  @Get('download-file')
  async downloadFile(
    @Query('url') url: string,
    @Query('filename') filename: string,
    @Res() res: Response,
  ) {
    if (!url) {
      return res.status(HttpStatus.BAD_REQUEST).send('URL is required');
    }
    const safeFilename = filename || 'video.mp4';
    try {
      const response = await fetch(url);

      if (!response.ok) {
        return res.status(response.status).send(response.statusText);
      }

      res.set({
        'Content-Disposition': `attachment; filename="${encodeURIComponent(safeFilename)}"`,
        'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
        'Content-Length': response.headers.get('content-length'),
        'Access-Control-Allow-Origin': '*',
      });

      if (response.body) {
        // @ts-ignore
        for await (const chunk of response.body) {
          res.write(chunk);
        }
        res.end();
      } else {
        res.end();
      }
    } catch (error) {
      // console.error('Download proxy error:', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).send('Download proxy error');
    }
  }

  /**
   * Webhook endpoint called by Modal when the background upscale job completes.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleModalWebhook(@Body() payload: any) {
    // Process the result asynchronously so we return HTTP 200 instantly to Modal!
    this.videoService.handleUpscaleWebhook(payload).catch((err) => {
      console.error('[Webhook] Error processing webhook payload:', err.message);
    });
    return { success: true };
  }

  /**
   * Tạo 10 hook TikTok affiliate từ link sản phẩm.
   * Gọi booking-api.tiktoday.vn để lấy thông tin sản phẩm, sau đó dùng Gemini tạo hooks.
   */
  @Post('product-hooks')
  @UseGuards(SupabaseAuthGuard)
  @HttpCode(HttpStatus.OK)
  async generateProductHooks(@Req() req: any, @Body() body: { url: string }) {
    if (!body?.url) {
      throw new BadRequestException('url là bắt buộc.');
    }
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('Unauthorized');
    }
    return this.videoService.generateProductHooks(body.url, userId);
  }
}

