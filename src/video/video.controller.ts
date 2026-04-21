import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { VideoService } from './video.service';

@Controller('video')
export class VideoController {
  constructor(private readonly videoService: VideoService) {}

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
}
