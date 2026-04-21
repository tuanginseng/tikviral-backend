import { VideoService } from './video.service';
export declare class VideoController {
    private readonly videoService;
    constructor(videoService: VideoService);
    downloadVideo(body: {
        url: string;
    }): Promise<import("./video.service").VideoDownloadResult>;
}
