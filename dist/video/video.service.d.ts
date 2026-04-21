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
}
export declare class VideoService {
    private readonly configService;
    private readonly logger;
    constructor(configService: ConfigService);
    downloadVideo(url: string): Promise<VideoDownloadResult>;
    private downloadFromTikWM;
    private downloadFromRapidApi;
    private isValidTikTokUrl;
}
