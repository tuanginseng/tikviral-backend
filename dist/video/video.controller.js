"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VideoController = void 0;
const common_1 = require("@nestjs/common");
const video_service_1 = require("./video.service");
let VideoController = class VideoController {
    videoService;
    constructor(videoService) {
        this.videoService = videoService;
    }
    async downloadVideo(body) {
        return this.videoService.downloadVideo(body.url);
    }
    async proxyMedia(url, res) {
        if (!url) {
            return res.status(common_1.HttpStatus.BAD_REQUEST).send('URL is required');
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
            if (response.body) {
                for await (const chunk of response.body) {
                    res.write(chunk);
                }
                res.end();
            }
            else {
                res.end();
            }
        }
        catch (error) {
            console.error('Proxy error:', error);
            res.status(common_1.HttpStatus.INTERNAL_SERVER_ERROR).send('Proxy error');
        }
    }
};
exports.VideoController = VideoController;
__decorate([
    (0, common_1.Post)('download'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], VideoController.prototype, "downloadVideo", null);
__decorate([
    (0, common_1.Get)('proxy'),
    __param(0, (0, common_1.Query)('url')),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], VideoController.prototype, "proxyMedia", null);
exports.VideoController = VideoController = __decorate([
    (0, common_1.Controller)('video'),
    __metadata("design:paramtypes", [video_service_1.VideoService])
], VideoController);
//# sourceMappingURL=video.controller.js.map