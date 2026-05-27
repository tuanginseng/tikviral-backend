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
const supabase_auth_guard_1 = require("../auth/supabase-auth.guard");
const platform_express_1 = require("@nestjs/platform-express");
let VideoController = class VideoController {
    videoService;
    constructor(videoService) {
        this.videoService = videoService;
    }
    async uploadFileR2(req, file) {
        if (!file) {
            throw new common_1.BadRequestException('Vui lòng chọn file video.');
        }
        const userId = req.user.id;
        const uploadName = `${userId}/${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '')}`;
        const r2Url = await this.videoService.uploadToR2(uploadName, file.buffer, file.mimetype);
        return { success: true, url: r2Url };
    }
    async upscaleVideo(req, body) {
        return this.videoService.upscaleVideo(req.user.id, body.video_url, body.file_name);
    }
    async cancelUpscale(req, body) {
        return this.videoService.cancelUpscale(req.user.id, body.id);
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
    async downloadFile(url, filename, res) {
        if (!url) {
            return res.status(common_1.HttpStatus.BAD_REQUEST).send('URL is required');
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
            console.error('Download proxy error:', error);
            res.status(common_1.HttpStatus.INTERNAL_SERVER_ERROR).send('Download proxy error');
        }
    }
    async handleModalWebhook(payload) {
        this.videoService.handleUpscaleWebhook(payload).catch((err) => {
            console.error('[Webhook] Error processing webhook payload:', err.message);
        });
        return { success: true };
    }
};
exports.VideoController = VideoController;
__decorate([
    (0, common_1.Post)('upload-r2'),
    (0, common_1.UseGuards)(supabase_auth_guard_1.SupabaseAuthGuard),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file')),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], VideoController.prototype, "uploadFileR2", null);
__decorate([
    (0, common_1.Post)('upscale'),
    (0, common_1.UseGuards)(supabase_auth_guard_1.SupabaseAuthGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], VideoController.prototype, "upscaleVideo", null);
__decorate([
    (0, common_1.Post)('cancel'),
    (0, common_1.UseGuards)(supabase_auth_guard_1.SupabaseAuthGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], VideoController.prototype, "cancelUpscale", null);
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
__decorate([
    (0, common_1.Get)('download-file'),
    __param(0, (0, common_1.Query)('url')),
    __param(1, (0, common_1.Query)('filename')),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], VideoController.prototype, "downloadFile", null);
__decorate([
    (0, common_1.Post)('webhook'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], VideoController.prototype, "handleModalWebhook", null);
exports.VideoController = VideoController = __decorate([
    (0, common_1.Controller)('video'),
    __metadata("design:paramtypes", [video_service_1.VideoService])
], VideoController);
//# sourceMappingURL=video.controller.js.map