import { ConfigService } from '@nestjs/config';
import { UsageService } from '../usage/usage.service';
import { SupabaseService } from '../supabase/supabase.service';
export interface VideoMetrics {
    play_count: number;
    digg_count: number;
    comment_count: number;
    share_count: number;
    title: string;
    cover?: string;
}
export interface VideoDownloadResult {
    videoBase64?: string;
    mimeType?: string;
    metrics: VideoMetrics | null;
    source: string;
    videoUrl: string;
}
export declare class VideoService {
    private readonly configService;
    private readonly usageService;
    private readonly supabaseService;
    private readonly logger;
    private readonly WORKFLOW_MODE;
    constructor(configService: ConfigService, usageService: UsageService, supabaseService: SupabaseService);
    downloadVideo(url: string): Promise<VideoDownloadResult>;
    private downloadFromTikWM;
    private downloadFromRapidApi;
    private isValidTikTokUrl;
    upscaleVideo(userId: string, videoUrl: string, originalFileName?: string): Promise<{
        success: boolean;
        url?: string;
        message?: string;
        id?: string;
    }>;
    private transcodeForUpscale;
    private mergeAudioIntoVideo;
    private processUpscaleInBackground;
    uploadToR2(fileName: string, fileBuffer: Buffer, mimeType: string): Promise<string>;
    makeHttpsRequest(url: string, body: any, method?: 'POST' | 'GET'): Promise<any>;
    handleUpscaleWebhook(payload: any): Promise<void>;
    cancelUpscale(userId: string, dbRecordId: string): Promise<any>;
}
