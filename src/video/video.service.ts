import { Injectable, InternalServerErrorException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface VideoMetrics {
  play_count: number;
  digg_count: number;
  comment_count: number;
  share_count: number;
  title: string;
  cover?: string;
}

export interface VideoDownloadResult {
  videoBase64: string;
  mimeType: string;
  metrics: VideoMetrics | null;
  source: string;
  videoUrl: string;
}

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  constructor(private readonly configService: ConfigService) {}

  async downloadVideo(url: string): Promise<VideoDownloadResult> {
    if (!url || !this.isValidTikTokUrl(url)) {
      throw new BadRequestException('URL TikTok không hợp lệ');
    }

    // Thử TikWM trước (không cần API key riêng)
    try {

      return await this.downloadFromTikWM(url);
    } catch (tikwmError: any) {
      this.logger.warn(`TikWM failed: ${tikwmError.message}. Trying RapidAPI...`);
    }

    // Fallback: RapidAPI (key lưu server-side, không bao giờ lộ ra frontend)
    try {

      return await this.downloadFromRapidApi(url);
    } catch (rapidError: any) {
      this.logger.error(`RapidAPI also failed: ${rapidError.message}`);
      throw new InternalServerErrorException(
        'Không thể tải video. Vui lòng kiểm tra URL hoặc thử lại sau.'
      );
    }
  }

  private async downloadFromTikWM(url: string): Promise<VideoDownloadResult> {
    const tikwmApiEndpoint = 'https://www.tikwm.com/api/';
    const requestBody = new URLSearchParams({
      url,
      count: '12',
      cursor: '0',
      web: '1',
      hd: '1',
    }).toString();

    const apiResponse = await fetch(tikwmApiEndpoint, {
      method: 'POST',
      headers: {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.6,en;q=0.5',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Origin': 'https://www.tikwm.com',
        'Referer': 'https://www.tikwm.com/',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: requestBody,
    });

    if (!apiResponse.ok) {
      throw new Error(`TikWM API HTTP error: ${apiResponse.status}`);
    }

    const tikwmData = await apiResponse.json();
    const videoData = tikwmData?.data;

    if (!videoData?.play) {
      throw new Error('TikWM không trả về URL video hợp lệ');
    }

    const videoUrl = `https://www.tikwm.com${videoData.play}`;
    const videoResponse = await fetch(videoUrl);

    if (!videoResponse.ok) {
      throw new Error(`Không thể tải video từ TikWM: ${videoResponse.status}`);
    }

    const videoBuffer = await videoResponse.arrayBuffer();
    const videoBase64 = Buffer.from(videoBuffer).toString('base64');
    const mimeType = videoResponse.headers.get('content-type') || 'video/mp4';

    const metrics: VideoMetrics | null = (videoData.title || videoData.play_count)
      ? {
          play_count: videoData.play_count || 0,
          digg_count: videoData.digg_count || 0,
          comment_count: videoData.comment_count || 0,
          share_count: videoData.share_count || 0,
          title: videoData.title || 'TikTok Video',
          cover: videoData.cover,
        }
      : null;

    return { videoBase64, mimeType, metrics, source: 'tikwm', videoUrl };
  }

  private async downloadFromRapidApi(url: string): Promise<VideoDownloadResult> {
    // RapidAPI key được lấy từ .env - KHÔNG BAO GIỜ gửi về frontend
    const RAPIDAPI_KEY = this.configService.get<string>('RAPIDAPI_KEY');

    if (!RAPIDAPI_KEY) {
      throw new Error('RAPIDAPI_KEY chưa được cấu hình trong .env');
    }

    const apiUrl = `https://tiktok-download5.p.rapidapi.com/getVideo?url=${encodeURIComponent(url)}&hd=1`;
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': 'tiktok-download5.p.rapidapi.com',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (response.status === 429) {
      throw new Error('RapidAPI đã đạt giới hạn. Vui lòng thử lại sau.');
    }
    if (!response.ok) {
      throw new Error(`RapidAPI HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    if (!data || data.code !== 0 || !data.data) {
      throw new Error(`RapidAPI lỗi: ${data?.message || 'Unknown error'}`);
    }

    const videoData = data.data;
    const videoUrl = videoData.play || videoData.wmplay || videoData.hdplay;

    if (!videoUrl) {
      throw new Error('Không tìm thấy URL video trong RapidAPI response');
    }

    const videoResponse = await fetch(videoUrl);
    if (!videoResponse.ok) {
      throw new Error(`Không thể tải video từ RapidAPI URL: ${videoResponse.status}`);
    }

    const videoBuffer = await videoResponse.arrayBuffer();
    const videoBase64 = Buffer.from(videoBuffer).toString('base64');
    const mimeType = videoResponse.headers.get('content-type') || 'video/mp4';

    const metrics: VideoMetrics | null = (videoData.title || videoData.play_count)
      ? {
          play_count: videoData.play_count || 0,
          digg_count: videoData.digg_count || 0,
          comment_count: videoData.comment_count || 0,
          share_count: videoData.share_count || 0,
          title: videoData.title || 'TikTok Video',
          cover: videoData.cover || videoData.origin_cover,
        }
      : null;

    return { videoBase64, mimeType, metrics, source: 'rapidapi', videoUrl };
  }

  private isValidTikTokUrl(url: string): boolean {
    return /^https?:\/\/(www\.)?(tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)/.test(url);
  }
}
