import { Controller, Post, Body, HttpCode, HttpStatus, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { VideoService } from './video.service';

@Controller('video')
export class VideoController {
  constructor(private readonly videoService: VideoService) { }

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
      console.error('Proxy error:', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).send('Proxy error');
    }
  }
}
