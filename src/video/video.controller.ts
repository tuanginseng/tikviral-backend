import { Controller, Post, Delete, Param, Body, HttpCode, HttpStatus, Get, Query, Res, Req, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';

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
  async generateProductHooks(@Req() req: any, @Body() body: { url: string, useFallbackModel?: boolean }) {
    if (!body?.url) {
      throw new BadRequestException('url là bắt buộc.');
    }
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('Unauthorized');
    }
    return this.videoService.generateProductHooks(body.url, userId, body.useFallbackModel);
  }

  /**
   * TTS Proxy to Modal
   */
  @Post('tts')
  @UseGuards(SupabaseAuthGuard)
  async generateTTS(@Req() req: any, @Body() body: { text: string; voice?: string; ref_audio_b64?: string; ref_audio_url?: string }, @Res() res: Response) {
    if (!body?.text) {
      throw new BadRequestException('text is required');
    }
    if (body.text.length > 4000) {
      throw new BadRequestException('Text exceeds maximum length of 4000 characters');
    }
    const apiUrl = process.env.MODAL_TTS_URL;
    if (!apiUrl) {
      throw new BadRequestException('TTS API not configured');
    }

    try {
      const response = await fetch(`${apiUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: body.text,
          voice: body.voice || 'voice-1',
          ref_audio_b64: body.ref_audio_b64,
          ref_audio_url: body.ref_audio_url
        })
      });

      if (!response.ok) {
        return res.status(response.status).send('TTS API error');
      }

      res.set({
        'Content-Type': response.headers.get('content-type') || 'audio/wav',
        'Content-Length': response.headers.get('content-length'),
      });

      if (response.body) {
        // @ts-ignore
        for await (const chunk of response.body) {
          res.write(chunk);
        }
        res.end();
      }
    } catch (error) {
      console.error('TTS proxy error:', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).send('TTS proxy error');
    }
  }

  /**
   * Save a user's cloned voice (max 3 per user)
   */
  @Post('voices')
  @UseGuards(SupabaseAuthGuard)
  async saveVoice(@Req() req: any, @Body() body: { name: string; audio_url: string }) {
    if (!body?.name?.trim()) throw new BadRequestException('name is required');
    if (!body?.audio_url?.trim()) throw new BadRequestException('audio_url is required');

    const userId = req.user.id;
    const supabase = req['supabase'];
    if (!supabase) throw new BadRequestException('Supabase client not available');

    const { count, error: countError } = await supabase
      .from('user_voices')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (countError) throw new BadRequestException('Kh\u00f4ng th\u1ec3 ki\u1ec3m tra s\u1ed1 gi\u1ecdng hi\u1ec7n t\u1ea1i.');
    if ((count || 0) >= 3) {
      throw new BadRequestException('B\u1ea1n ch\u1ec9 c\u00f3 th\u1ec3 l\u01b0u t\u1ed1i \u0111a 3 gi\u1ecdng \u0111\u1ecdc. Vui l\u00f2ng x\u00f3a gi\u1ecdng c\u0169 tr\u01b0\u1edbc khi th\u00eam gi\u1ecdng m\u1edbi.');
    }

    const { data, error } = await supabase
      .from('user_voices')
      .insert({ user_id: userId, name: body.name.trim(), audio_url: body.audio_url })
      .select()
      .single();

    if (error) throw new BadRequestException('Kh\u00f4ng th\u1ec3 l\u01b0u gi\u1ecdng v\u00e0o c\u01a1 s\u1edf d\u1eef li\u1ec7u.');
    return data;
  }

  /**
   * Delete a user's saved voice
   */
  @Delete('voices/:id')
  @UseGuards(SupabaseAuthGuard)
  async deleteVoice(@Req() req: any, @Param('id') id: string) {
    const userId = req.user.id;
    const supabase = req['supabase'];
    if (!supabase) throw new BadRequestException('Supabase client not available');

    const { error } = await supabase
      .from('user_voices')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw new BadRequestException('Kh\u00f4ng th\u1ec3 x\u00f3a gi\u1ecdng.');
    return { success: true };
  }
}

