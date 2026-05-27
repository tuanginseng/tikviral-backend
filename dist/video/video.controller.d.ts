import type { Response } from 'express';
import { VideoService } from './video.service';
export declare class VideoController {
    private readonly videoService;
    constructor(videoService: VideoService);
    uploadFileR2(req: any, file: any): Promise<{
        success: boolean;
        url: string;
    }>;
    upscaleVideo(req: any, body: {
        video_url: string;
        file_name?: string;
    }): Promise<{
        success: boolean;
        url?: string;
        message?: string;
        id?: string;
    }>;
    cancelUpscale(req: any, body: {
        id: string;
    }): Promise<any>;
    downloadVideo(body: {
        url: string;
    }): Promise<import("./video.service").VideoDownloadResult>;
    proxyMedia(url: string, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    downloadFile(url: string, filename: string, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    handleModalWebhook(payload: any): Promise<{
        success: boolean;
    }>;
}
