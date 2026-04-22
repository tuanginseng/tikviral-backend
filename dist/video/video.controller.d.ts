import type { Response } from 'express';
import { VideoService } from './video.service';
export declare class VideoController {
    private readonly videoService;
    constructor(videoService: VideoService);
    downloadVideo(body: {
        url: string;
    }): Promise<import("./video.service").VideoDownloadResult>;
    proxyMedia(url: string, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
}
