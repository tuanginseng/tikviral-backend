"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var VideoService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.VideoService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const usage_service_1 = require("../usage/usage.service");
const supabase_service_1 = require("../supabase/supabase.service");
const client_s3_1 = require("@aws-sdk/client-s3");
const https = __importStar(require("https"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
let VideoService = VideoService_1 = class VideoService {
    configService;
    usageService;
    supabaseService;
    logger = new common_1.Logger(VideoService_1.name);
    WORKFLOW_MODE = 'AI_UPSCALED_540P';
    constructor(configService, usageService, supabaseService) {
        this.configService = configService;
        this.usageService = usageService;
        this.supabaseService = supabaseService;
        ffmpeg.setFfmpegPath(ffmpegInstaller.path);
    }
    async downloadVideo(url) {
        if (!url || !this.isValidTikTokUrl(url)) {
            throw new common_1.BadRequestException('URL TikTok không hợp lệ');
        }
        try {
            return await this.downloadFromTikWM(url);
        }
        catch (tikwmError) {
            this.logger.warn(`TikWM failed: ${tikwmError.message}. Trying RapidAPI...`);
        }
        try {
            return await this.downloadFromRapidApi(url);
        }
        catch (rapidError) {
            this.logger.error(`RapidAPI also failed: ${rapidError.message}`);
            throw new common_1.InternalServerErrorException('Không thể tải video. Vui lòng kiểm tra URL hoặc thử lại sau.');
        }
    }
    async downloadFromTikWM(url) {
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
        const videoBase64 = '';
        const mimeType = 'video/mp4';
        const metrics = (videoData.title || videoData.play_count)
            ? {
                play_count: videoData.play_count || 0,
                digg_count: videoData.digg_count || 0,
                comment_count: videoData.comment_count || 0,
                share_count: videoData.share_count || 0,
                title: videoData.title || 'TikTok Video',
                cover: videoData.cover,
            }
            : null;
        return { metrics, source: 'tikwm', videoUrl, videoBase64, mimeType };
    }
    async downloadFromRapidApi(url) {
        const RAPIDAPI_KEY = this.configService.get('RAPIDAPI_KEY');
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
        const videoBase64 = '';
        const mimeType = 'video/mp4';
        const metrics = (videoData.title || videoData.play_count)
            ? {
                play_count: videoData.play_count || 0,
                digg_count: videoData.digg_count || 0,
                comment_count: videoData.comment_count || 0,
                share_count: videoData.share_count || 0,
                title: videoData.title || 'TikTok Video',
                cover: videoData.cover || videoData.origin_cover,
            }
            : null;
        return { metrics, source: 'rapidapi', videoUrl, videoBase64, mimeType };
    }
    isValidTikTokUrl(url) {
        return /^https?:\/\/(www\.)?(tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)/.test(url);
    }
    async upscaleVideo(userId, videoUrl, originalFileName) {
        const supabase = this.supabaseService.getAdminClient();
        const { data: pendingJobs, error: pendingError } = await supabase
            .from('upscaled_videos')
            .select('id')
            .eq('user_id', userId)
            .eq('status', 'pending');
        if (pendingError) {
            this.logger.error(`Failed to check pending upscale jobs: ${pendingError.message}`);
        }
        else if (pendingJobs && pendingJobs.length > 0) {
            throw new common_1.BadRequestException('Bạn đang có một tiến trình làm nét khác đang chạy. Vui lòng chờ tiến trình này hoàn tất.');
        }
        const profile = await this.usageService.getProfile(userId);
        const isSubscribed = profile && (profile.monthly_credit_balance > 0);
        if (!isSubscribed) {
            throw new common_1.BadRequestException('Tính năng làm nét video (Upscale) chỉ dành cho tài khoản đã mua gói tháng. Vui lòng nâng cấp tài khoản của bạn để sử dụng.');
        }
        const usage = await this.usageService.checkUsage(userId);
        if (!usage.success) {
            throw new common_1.BadRequestException('Bạn đã hết lượt sử dụng. Vui lòng nâng cấp gói hoặc mua thêm.');
        }
        await this.usageService.incrementUsage(userId);
        const modalUrl = this.configService.get('MODAL_UPSCALE_URL');
        if (!modalUrl) {
            this.logger.error('MODAL_UPSCALE_URL is not configured');
            throw new common_1.InternalServerErrorException('Hệ thống AI chưa được cấu hình. Vui lòng liên hệ Admin.');
        }
        const jobId = `upscale_${Date.now()}_${userId.slice(0, 5)}`;
        let dbRecordId = null;
        try {
            const { data: dbData, error: dbError } = await supabase
                .from('upscaled_videos')
                .insert({
                user_id: userId,
                video_url: videoUrl,
                video_title: `${originalFileName || 'upscaled_video.mp4'}####[1/4] Đang chuẩn hoá video & trích xuất âm thanh...##20`,
                duration_seconds: null,
                size_mb: null,
                status: 'pending'
            })
                .select('id')
                .single();
            if (dbError) {
                this.logger.error(`Failed to insert pending upscale record: ${dbError.message}`);
                throw new Error(`DB Error: ${dbError.message}`);
            }
            dbRecordId = dbData.id;
            this.processUpscaleInBackground(userId, dbRecordId, videoUrl, jobId, modalUrl, originalFileName);
            return {
                success: true,
                message: 'Đã nhận yêu cầu làm nét. Tiến trình đang chạy ngầm.',
                id: dbRecordId || undefined
            };
        }
        catch (e) {
            this.logger.error(`Upscale initiation failed: ${e.message}`);
            if (dbRecordId) {
                try {
                    await supabase
                        .from('upscaled_videos')
                        .update({ status: 'failed' })
                        .eq('id', dbRecordId);
                }
                catch (_) { }
            }
            throw new common_1.InternalServerErrorException('Không thể khởi tạo quá trình làm nét: ' + e.message);
        }
    }
    async transcodeForUpscale(videoUrl, jobId) {
        const tmpDir = os.tmpdir();
        const tempInputPath = path.join(tmpDir, `input_${jobId}.mp4`);
        const tempVideoPath = path.join(tmpDir, `transcoded_${jobId}.mp4`);
        const tempAudioPath = path.join(tmpDir, `audio_${jobId}.aac`);
        this.logger.log(`[Transcode] Downloading input video for job ${jobId}...`);
        const response = await fetch(videoUrl);
        if (!response.ok) {
            throw new Error(`Failed to download video for transcode: HTTP ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        fs.writeFileSync(tempInputPath, Buffer.from(arrayBuffer));
        this.logger.log(`[Transcode] Input downloaded (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB).`);
        let audioBuffer = null;
        try {
            await new Promise((resolve, reject) => {
                ffmpeg(tempInputPath)
                    .outputOptions(['-vn', '-c:a aac', '-b:a 128k'])
                    .output(tempAudioPath)
                    .on('end', () => resolve())
                    .on('error', (err) => reject(err))
                    .run();
            });
            if (fs.existsSync(tempAudioPath)) {
                audioBuffer = fs.readFileSync(tempAudioPath);
                this.logger.log(`[Transcode] Audio extracted: ${(audioBuffer.length / 1024).toFixed(0)} KB`);
            }
        }
        catch (audioErr) {
            this.logger.warn(`[Transcode] No audio track found (video may be silent): ${audioErr.message}`);
        }
        let targetDimension = 1280;
        if (this.WORKFLOW_MODE === 'AI_UPSCALED_540P') {
            targetDimension = 960;
        }
        else if (this.WORKFLOW_MODE === 'NATIVE_1080P') {
            targetDimension = 1920;
        }
        const scaleFilter = `scale='if(gt(iw,ih),min(${targetDimension},iw),-2)':'if(gt(iw,ih),-2,min(${targetDimension},ih))'`;
        await new Promise((resolve, reject) => {
            ffmpeg(tempInputPath)
                .outputOptions([
                `-vf ${scaleFilter}`,
                '-c:v libx264',
                '-crf 20',
                '-preset fast',
                '-an',
                '-movflags +faststart',
            ])
                .output(tempVideoPath)
                .on('end', () => resolve())
                .on('error', (err) => reject(new Error(`FFmpeg normalization failed: ${err.message}`)))
                .run();
        });
        const videoBuffer = fs.readFileSync(tempVideoPath);
        this.logger.log(`[Transcode] Video normalized (original 1080p/720p resolution preserved): ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);
        return { videoBuffer, audioBuffer, tempPaths: [tempInputPath, tempVideoPath, tempAudioPath] };
    }
    async mergeAudioIntoVideo(videoBuffer, audioUrl, jobId) {
        const tmpDir = os.tmpdir();
        const tempVideoPath = path.join(tmpDir, `merge_video_${jobId}.mp4`);
        const tempAudioPath = path.join(tmpDir, `merge_audio_${jobId}.aac`);
        const tempOutputPath = path.join(tmpDir, `final_${jobId}.mp4`);
        this.logger.log(`[Scale & Merge] Processing video to 1080p (Full HD) for job ${jobId}...`);
        fs.writeFileSync(tempVideoPath, videoBuffer);
        let hasAudio = false;
        if (audioUrl) {
            try {
                this.logger.log(`[Scale & Merge] Downloading audio from R2 for merge...`);
                const audioResponse = await fetch(audioUrl);
                if (audioResponse.ok) {
                    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
                    fs.writeFileSync(tempAudioPath, audioBuffer);
                    hasAudio = true;
                }
                else {
                    this.logger.warn(`[Scale & Merge] Failed to download audio from ${audioUrl}: HTTP ${audioResponse.status}`);
                }
            }
            catch (audioErr) {
                this.logger.warn(`[Scale & Merge] Error fetching audio: ${audioErr.message}`);
            }
        }
        await new Promise((resolve, reject) => {
            let command = ffmpeg(tempVideoPath);
            const options = [
                '-c:v copy',
                '-movflags +faststart',
            ];
            if (hasAudio) {
                command = command.addInput(tempAudioPath);
                options.push('-c:a aac', '-b:a 128k', '-shortest');
            }
            command
                .outputOptions(options)
                .output(tempOutputPath)
                .on('end', () => resolve())
                .on('error', (err) => reject(new Error(`FFmpeg scale/merge failed: ${err.message}`)))
                .run();
        });
        const finalBuffer = fs.readFileSync(tempOutputPath);
        this.logger.log(`[Scale & Merge] Completed. Final size: ${(finalBuffer.length / 1024 / 1024).toFixed(2)} MB`);
        [tempVideoPath, tempAudioPath, tempOutputPath].forEach((p) => {
            try {
                if (fs.existsSync(p))
                    fs.unlinkSync(p);
            }
            catch (_) { }
        });
        return finalBuffer;
    }
    async processUpscaleInBackground(userId, dbRecordId, videoUrl, jobId, modalUrl, originalFileName) {
        const supabase = this.supabaseService.getAdminClient();
        this.logger.log(`[Background Job] Starting upscale for record ${dbRecordId} (Job: ${jobId})`);
        try {
            const webhookUrl = this.configService.get('WEBHOOK_URL');
            this.logger.log(`[Background Job] Starting transcode step for job ${jobId}...`);
            let uploadUrl = videoUrl;
            let audioR2Url = null;
            let skipResize = false;
            try {
                const { videoBuffer, audioBuffer, tempPaths } = await this.transcodeForUpscale(videoUrl, jobId);
                tempPaths.forEach((p) => { try {
                    if (fs.existsSync(p))
                        fs.unlinkSync(p);
                }
                catch (_) { } });
                const transcodedFileName = `${userId}/transcoded_${jobId}.mp4`;
                uploadUrl = await this.uploadToR2(transcodedFileName, videoBuffer, 'video/mp4');
                this.logger.log(`[Background Job] Scaled video uploaded to R2: ${uploadUrl}`);
                if (audioBuffer && audioBuffer.length > 0) {
                    const audioFileName = `${userId}/audio_${jobId}.aac`;
                    audioR2Url = await this.uploadToR2(audioFileName, audioBuffer, 'audio/aac');
                    this.logger.log(`[Background Job] Audio uploaded to R2: ${audioR2Url}`);
                }
                skipResize = true;
            }
            catch (transcodeErr) {
                this.logger.warn(`[Background Job] Transcode failed, using original video. Reason: ${transcodeErr.message}`);
                uploadUrl = videoUrl;
            }
            let outscale = '1.5';
            let mode = 'fast';
            if (this.WORKFLOW_MODE === 'AI_UPSCALED_540P') {
                outscale = '2';
                mode = 'quality';
            }
            else if (this.WORKFLOW_MODE === 'NATIVE_1080P') {
                outscale = '1';
                mode = 'fast';
            }
            const payload = {
                video_url: uploadUrl,
                job_id: jobId,
                skip_resize: skipResize,
                mode,
                outscale,
                ...(webhookUrl ? {
                    webhook_url: webhookUrl,
                    metadata: { userId, dbRecordId, originalFileName }
                } : {})
            };
            const { data: currentJob } = await supabase
                .from('upscaled_videos')
                .select('status')
                .eq('id', dbRecordId)
                .single();
            if (currentJob?.status === 'cancelled') {
                this.logger.log(`[Background Job] Job ${dbRecordId} was cancelled before spawning. Aborting.`);
                return;
            }
            await supabase
                .from('upscaled_videos')
                .update({ video_title: `${originalFileName || 'upscaled_video.mp4'}####[2/4] Đang kết nối và khởi động GPU AI Worker...##40` })
                .eq('id', dbRecordId);
            const spawnData = await this.makeHttpsRequest(modalUrl, payload);
            if (!spawnData.call_id) {
                throw new Error(`Failed to spawn Modal worker: ${JSON.stringify(spawnData)}`);
            }
            const titleWithMeta = `${originalFileName || 'upscaled_video.mp4'}##${spawnData.call_id}##${audioR2Url || ''}##[3/4] AI đang tăng độ nét từng khung hình (GPU)...##70`;
            await supabase
                .from('upscaled_videos')
                .update({ video_title: titleWithMeta })
                .eq('id', dbRecordId);
            if (webhookUrl) {
                this.logger.log(`[Background Job] Spawned background Modal task (Call ID: ${spawnData.call_id}) with Webhook: ${webhookUrl}. Terminating thread, waiting for callback.`);
                return;
            }
            this.logger.log(`[Background Job] Spawned background Modal task (Call ID: ${spawnData.call_id}). No Webhook configured, starting polling loop...`);
            const statusUrl = modalUrl.replace('-enhance-video', '-get-status') + `?call_id=${spawnData.call_id}`;
            let data = null;
            const startTime = Date.now();
            const maxDuration = 35 * 60 * 1000;
            while (Date.now() - startTime < maxDuration) {
                await new Promise((r) => setTimeout(r, 5000));
                const { data: currentRecord } = await supabase
                    .from('upscaled_videos')
                    .select('status')
                    .eq('id', dbRecordId)
                    .single();
                if (currentRecord?.status === 'cancelled') {
                    this.logger.log(`[Background Job] Job ${dbRecordId} was cancelled by user. Stopping polling loop.`);
                    return;
                }
                try {
                    const pollRes = await this.makeHttpsRequest(statusUrl, null, 'GET');
                    if (pollRes.status === 'done') {
                        data = pollRes;
                        break;
                    }
                    else if (pollRes.status === 'error') {
                        throw new Error(`Modal AI Worker failed: ${pollRes.message}`);
                    }
                    this.logger.log(`[Background Job] Polling job ${jobId} status: ${pollRes.status || 'processing'}`);
                }
                catch (pollErr) {
                    this.logger.warn(`[Background Job] Minor error polling job ${jobId}: ${pollErr.message}. Retrying...`);
                }
            }
            if (!data || data.status !== 'done' || !data.video_base64) {
                throw new Error('Upscaling job timed out or returned invalid format.');
            }
            await supabase
                .from('upscaled_videos')
                .update({ video_title: `${originalFileName || 'upscaled_video.mp4'}##${spawnData.call_id}##${audioR2Url || ''}##[4/4] Đang ghép nhạc & tối ưu chất lượng cuối...##90` })
                .eq('id', dbRecordId);
            let finalVideoBuffer = Buffer.from(data.video_base64, 'base64');
            const fileName = `${userId}/${jobId}.mp4`;
            try {
                finalVideoBuffer = await this.mergeAudioIntoVideo(finalVideoBuffer, audioR2Url, jobId);
            }
            catch (mergeErr) {
                this.logger.warn(`[Background Job] Scale & audio merge failed. Reason: ${mergeErr.message}`);
            }
            const r2Url = await this.uploadToR2(fileName, finalVideoBuffer, 'video/mp4');
            const { error: dbUpdateError } = await supabase
                .from('upscaled_videos')
                .update({
                video_url: r2Url,
                video_title: originalFileName || 'upscaled_video.mp4',
                duration_seconds: data.duration_seconds || null,
                size_mb: data.size_mb || null,
                status: 'completed'
            })
                .eq('id', dbRecordId);
            if (dbUpdateError) {
                this.logger.error(`[Background Job] Failed to update upscale record ${dbRecordId} to completed: ${dbUpdateError.message}`);
            }
            else {
                this.logger.log(`[Background Job] Upscale record ${dbRecordId} successfully completed!`);
                const durationSeconds = data.duration_seconds || 0;
                const totalCreditsNeeded = Math.ceil(durationSeconds / 60);
                const remainingCreditsToDeduct = totalCreditsNeeded - 1;
                if (remainingCreditsToDeduct > 0) {
                    this.logger.log(`[Background Job] Video processed in ${durationSeconds}s. Charging ${totalCreditsNeeded} credits in total. Deducting remaining ${remainingCreditsToDeduct} credits for user ${userId}.`);
                    await this.usageService.deductCredits(userId, remainingCreditsToDeduct);
                }
                else {
                    this.logger.log(`[Background Job] Video processed in ${durationSeconds}s. Charged 1 credit deposit at start. No additional credits deducted.`);
                }
            }
        }
        catch (e) {
            this.logger.error(`[Background Job] Upscale execution failed for record ${dbRecordId}: ${e.message}`);
            try {
                await supabase
                    .from('upscaled_videos')
                    .update({
                    status: 'failed',
                    video_title: originalFileName || 'upscaled_video.mp4'
                })
                    .eq('id', dbRecordId);
                this.logger.log(`[Background Job] Updated upscale record ${dbRecordId} to 'failed' status`);
            }
            catch (dbErr) {
                this.logger.error(`[Background Job] Failed to mark upscale record as failed in DB: ${dbErr.message}`);
            }
        }
    }
    async uploadToR2(fileName, fileBuffer, mimeType) {
        const accountId = this.configService.get('R2_ACCOUNT_ID');
        const accessKeyId = this.configService.get('R2_ACCESS_KEY_ID');
        const secretAccessKey = this.configService.get('R2_SECRET_ACCESS_KEY');
        const bucketName = this.configService.get('R2_BUCKET_NAME') || 'tikviral';
        const publicUrlBase = this.configService.get('R2_PUBLIC_URL');
        if (!accountId || !accessKeyId || !secretAccessKey) {
            throw new Error('Cloudflare R2 is not fully configured with S3 credentials in environment variables');
        }
        const cleanFileName = fileName.replace(/\\/g, '/');
        try {
            this.logger.log(`Uploading ${cleanFileName} (${fileBuffer.length} bytes) to Cloudflare R2 using S3 Client`);
            const s3Client = new client_s3_1.S3Client({
                region: 'auto',
                endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
                credentials: {
                    accessKeyId,
                    secretAccessKey,
                },
            });
            await s3Client.send(new client_s3_1.PutObjectCommand({
                Bucket: bucketName,
                Key: cleanFileName,
                Body: fileBuffer,
                ContentType: mimeType,
            }));
            this.logger.log(`Successfully uploaded ${cleanFileName} to Cloudflare R2!`);
            if (publicUrlBase) {
                return `${publicUrlBase.replace(/\/$/, '')}/${cleanFileName}`;
            }
            return `https://pub-${accountId}.r2.dev/${cleanFileName}`;
        }
        catch (e) {
            this.logger.error(`Cloudflare R2 Upload failed: ${e.message}`);
            throw new common_1.InternalServerErrorException(`Không thể tải file lên Cloudflare R2: ${e.message}`);
        }
    }
    async makeHttpsRequest(url, body, method = 'POST') {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const postData = body ? JSON.stringify(body) : '';
            const options = {
                hostname: urlObj.hostname,
                path: urlObj.pathname + urlObj.search,
                method: method,
                headers: {
                    ...(body ? {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData),
                    } : {}),
                },
                timeout: 0,
            };
            const req = https.request(options, (res) => {
                let rawData = '';
                res.on('data', (chunk) => {
                    rawData += chunk;
                });
                res.on('end', () => {
                    try {
                        const statusCode = res.statusCode || 500;
                        if (statusCode < 200 || statusCode >= 300) {
                            return reject(new Error(`HTTPS error: ${statusCode} ${res.statusMessage}`));
                        }
                        const parsed = JSON.parse(rawData);
                        resolve(parsed);
                    }
                    catch (err) {
                        reject(new Error(`Failed to parse HTTPS response: ${err.message}`));
                    }
                });
            });
            req.on('error', (err) => {
                reject(err);
            });
            req.on('socket', (socket) => {
                socket.setTimeout(0);
                socket.setKeepAlive(true, 15000);
            });
            if (body) {
                req.write(postData);
            }
            req.end();
        });
    }
    async handleUpscaleWebhook(payload) {
        const supabase = this.supabaseService.getAdminClient();
        const jobId = payload.job_id;
        const { userId, dbRecordId, originalFileName } = payload.metadata || {};
        if (!dbRecordId) {
            this.logger.error(`[Webhook] Missing dbRecordId in metadata: ${JSON.stringify(payload.metadata)}`);
            return;
        }
        this.logger.log(`[Webhook] Received webhook callback for job ${jobId} (Record: ${dbRecordId}). Status: ${payload.status}`);
        try {
            if (payload.status === 'error') {
                throw new Error(payload.message || 'Modal processing failed');
            }
            if (!payload.video_base64) {
                throw new Error('Missing video_base64 in webhook payload');
            }
            const { data: dbRecord } = await supabase
                .from('upscaled_videos')
                .select('video_title')
                .eq('id', dbRecordId)
                .single();
            const titleParts = (dbRecord?.video_title || '').split('##');
            const audioR2Url = titleParts[2] || null;
            await supabase
                .from('upscaled_videos')
                .update({ video_title: `${originalFileName || 'upscaled_video.mp4'}##${jobId}##${audioR2Url || ''}##[4/4] Đang ghép nhạc & tối ưu chất lượng cuối...##90` })
                .eq('id', dbRecordId);
            let finalVideoBuffer = Buffer.from(payload.video_base64, 'base64');
            const fileName = `${userId}/${jobId}.mp4`;
            try {
                finalVideoBuffer = await this.mergeAudioIntoVideo(finalVideoBuffer, audioR2Url, jobId || dbRecordId);
            }
            catch (mergeErr) {
                this.logger.warn(`[Webhook] Scale & audio merge failed. Reason: ${mergeErr.message}`);
            }
            const r2Url = await this.uploadToR2(fileName, finalVideoBuffer, 'video/mp4');
            const { error: dbUpdateError } = await supabase
                .from('upscaled_videos')
                .update({
                video_url: r2Url,
                video_title: originalFileName || 'upscaled_video.mp4',
                duration_seconds: payload.duration_seconds || null,
                size_mb: payload.size_mb || null,
                status: 'completed'
            })
                .eq('id', dbRecordId);
            if (dbUpdateError) {
                this.logger.error(`[Webhook] Failed to update upscale record ${dbRecordId} to completed: ${dbUpdateError.message}`);
            }
            else {
                this.logger.log(`[Webhook] Upscale record ${dbRecordId} successfully completed via Webhook!`);
                const durationSeconds = payload.duration_seconds || 0;
                const totalCreditsNeeded = Math.ceil(durationSeconds / 60);
                const remainingCreditsToDeduct = totalCreditsNeeded - 1;
                if (remainingCreditsToDeduct > 0) {
                    this.logger.log(`[Webhook] Deducting remaining ${remainingCreditsToDeduct} credits for user ${userId}.`);
                    await this.usageService.deductCredits(userId, remainingCreditsToDeduct);
                }
            }
        }
        catch (e) {
            this.logger.error(`[Webhook] Processing failed for record ${dbRecordId}: ${e.message}`);
            try {
                await supabase
                    .from('upscaled_videos')
                    .update({
                    status: 'failed',
                    video_title: originalFileName || 'upscaled_video.mp4'
                })
                    .eq('id', dbRecordId);
            }
            catch (dbErr) {
                this.logger.error(`[Webhook] Failed to mark upscale record as failed in DB: ${dbErr.message}`);
            }
        }
    }
    async cancelUpscale(userId, dbRecordId) {
        const supabase = this.supabaseService.getAdminClient();
        this.logger.log(`[Cancel Job] Attempting to cancel upscale record ${dbRecordId} for user ${userId}`);
        try {
            const { data: record, error: getError } = await supabase
                .from('upscaled_videos')
                .select('*')
                .eq('id', dbRecordId)
                .eq('user_id', userId)
                .single();
            if (getError || !record) {
                throw new common_1.BadRequestException('Không tìm thấy tiến trình làm nét.');
            }
            if (record.status !== 'pending') {
                throw new common_1.BadRequestException('Tiến trình làm nét đã kết thúc hoặc đã được hủy trước đó.');
            }
            const titleParts = (record.video_title || '').split('##');
            const cleanTitle = titleParts[0] || 'upscaled_video.mp4';
            const callId = titleParts[1];
            this.logger.log(`[Cancel Job] Extracted clean title: "${cleanTitle}", callId: "${callId || 'none'}"`);
            await supabase
                .from('upscaled_videos')
                .update({
                status: 'cancelled',
                video_title: cleanTitle
            })
                .eq('id', dbRecordId);
            if (callId) {
                const modalUrl = this.configService.get('MODAL_UPSCALE_URL');
                if (modalUrl) {
                    const cancelUrl = modalUrl.replace('-enhance-video', '-cancel-job');
                    this.logger.log(`[Cancel Job] Calling Modal cancel API: ${cancelUrl} for call_id: ${callId}`);
                    try {
                        await this.makeHttpsRequest(cancelUrl, { call_id: callId });
                        this.logger.log(`[Cancel Job] Successfully sent cancel request to Modal.`);
                    }
                    catch (cancelErr) {
                        this.logger.error(`[Cancel Job] Failed to request Modal cancellation for ${callId}: ${cancelErr.message}`);
                    }
                }
            }
            return {
                success: true,
                message: 'Đã hủy tiến trình làm nét video thành công.'
            };
        }
        catch (e) {
            this.logger.error(`[Cancel Job] Failed to cancel job for record ${dbRecordId}: ${e.message}`);
            throw new common_1.InternalServerErrorException(e.message);
        }
    }
};
exports.VideoService = VideoService;
exports.VideoService = VideoService = VideoService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        usage_service_1.UsageService,
        supabase_service_1.SupabaseService])
], VideoService);
//# sourceMappingURL=video.service.js.map