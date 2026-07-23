import { Injectable, InternalServerErrorException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsageService } from '../usage/usage.service';
import { SupabaseService } from '../supabase/supabase.service';
import { GeminiService, FALLBACK_MODEL } from '../gemini/gemini.service';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Response } from 'express';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpeg = require('fluent-ffmpeg');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

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

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);
  private readonly WORKFLOW_MODE: 'AI_UPSCALED_720P' | 'AI_UPSCALED_540P' | 'NATIVE_1080P' = 'AI_UPSCALED_540P';

  constructor(
    private readonly configService: ConfigService,
    private readonly usageService: UsageService,
    private readonly supabaseService: SupabaseService,
    private readonly geminiService: GeminiService,
  ) {
    // Point fluent-ffmpeg to the bundled FFmpeg binary
    ffmpeg.setFfmpegPath(ffmpegInstaller.path);
  }

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
        'Không thể tải video. Vui lòng kiểm tra URL hoặc thử lại sau.',
      );
    }
  }

  /**
   * Nén video bằng FFmpeg server-side, sau đó upload lên R2 để Gemini fetch trực tiếp.
   * Giải pháp cho vấn đề: video upload từ máy khi convert sang base64 + JSON rất nặng → timeout.
   * Flow mới: upload blob → BE nén FFmpeg → lưu tạm trên R2 → trả URL → Gemini dùng URL.
   */
  async compressVideoBuffer(inputBuffer: Buffer, inputMimeType: string, userId: string): Promise<{ url: string; originalMb: number; compressedMb: number }> {
    const jobId = `compress_${Date.now()}`;
    const tmpDir = os.tmpdir();
    const ext = inputMimeType?.includes('mp4') ? '.mp4' : inputMimeType?.includes('webm') ? '.webm' : '.mp4';
    const tempInputPath = path.join(tmpDir, `input_${jobId}${ext}`);
    const tempOutputPath = path.join(tmpDir, `output_${jobId}.mp4`);

    const originalMb = inputBuffer.length / 1024 / 1024;
    this.logger.log(`[Compress] Starting server-side compression for job ${jobId} (${originalMb.toFixed(2)} MB)`);

    try {
      // Ghi buffer vào file tạm
      fs.writeFileSync(tempInputPath, inputBuffer);

      // Nén bằng FFmpeg: max 480p, 15fps, 600kbps, giữ aspect ratio
      await new Promise<void>((resolve, reject) => {
        ffmpeg(tempInputPath)
          .outputOptions([
            "-vf scale='if(gt(iw,ih),min(480,iw),-2)':'if(gt(iw,ih),-2,min(480,ih))'",
            '-r 15',
            '-c:v libx264',
            '-preset ultrafast',
            '-crf 30',
            '-c:a aac',
            '-b:a 96k',
            '-movflags +faststart',
          ])
          .output(tempOutputPath)
          .on('end', () => resolve())
          .on('error', (err: Error) => reject(new Error(`FFmpeg compression failed: ${err.message}`)))
          .run();
      });

      const outputBuffer = fs.readFileSync(tempOutputPath);
      const compressedMb = outputBuffer.length / 1024 / 1024;
      this.logger.log(`[Compress] Done. ${originalMb.toFixed(2)} MB → ${compressedMb.toFixed(2)} MB. Uploading to R2...`);

      // Upload lên R2 — Gemini sẽ fetch URL này trực tiếp, tránh base64 trên FE
      const r2Key = `${userId}/tmp_analysis_${jobId}.mp4`;
      const r2Url = await this.uploadToR2(r2Key, outputBuffer, 'video/mp4');

      this.logger.log(`[Compress] Uploaded to R2: ${r2Url}`);
      return { url: r2Url, originalMb, compressedMb };
    } finally {
      // Xoá file tạm
      [tempInputPath, tempOutputPath].forEach((p) => {
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) { }
      });
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

    const videoBase64 = '';
    const mimeType = 'video/mp4';

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

    return { metrics, source: 'tikwm', videoUrl, videoBase64, mimeType };
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

    const videoBase64 = '';
    const mimeType = 'video/mp4';

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

    return { metrics, source: 'rapidapi', videoUrl, videoBase64, mimeType };
  }

  private isValidTikTokUrl(url: string): boolean {
    return /^https?:\/\/(www\.)?(tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)/.test(url);
  }


  /**
   * Download video tu mot URL ben ngoai (VD: TikTok CDN), nen bang FFmpeg,
   * upload len R2 va tra ve URL stable de Gemini co the fetch.
   * Dung cho flow "phan tich video TikTok qua URL" - tranh URL CDN expire.
   */
  async compressVideoFromUrl(
    sourceUrl: string,
    userId: string,
  ): Promise<{ url: string; originalMb: number; compressedMb: number }> {
    this.logger.log(`[CompressFromUrl] Downloading video from: ${sourceUrl}`);

    // 1. Download video ve buffer
    const fetchResponse = await fetch(sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.tiktok.com/',
      },
    });
    if (!fetchResponse.ok) {
      throw new InternalServerErrorException(
        `Khong the tai video tu URL: HTTP ${fetchResponse.status}`,
      );
    }

    const contentType = fetchResponse.headers.get('content-type') || 'video/mp4';
    const arrayBuffer = await fetchResponse.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);

    this.logger.log(
      `[CompressFromUrl] Downloaded ${(inputBuffer.length / 1024 / 1024).toFixed(2)} MB. Starting compression...`,
    );

    // 2. Tai su dung pipeline compress + R2 upload
    return this.compressVideoBuffer(inputBuffer, contentType, userId);
  }

  async upscaleVideo(userId: string, videoUrl: string, originalFileName?: string): Promise<{ success: boolean; url?: string; message?: string; id?: string }> {
    const supabase = this.supabaseService.getAdminClient();

    // 0. Check if the user already has an active pending job
    const { data: pendingJobs, error: pendingError } = await supabase
      .from('upscaled_videos')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'pending');

    if (pendingError) {
      this.logger.error(`Failed to check pending upscale jobs: ${pendingError.message}`);
    } else if (pendingJobs && pendingJobs.length > 0) {
      throw new BadRequestException('Bạn đang có một tiến trình làm nét khác đang chạy. Vui lòng chờ tiến trình này hoàn tất.');
    }

    // 1. Check if user has an active monthly subscription
    const profile = await this.usageService.getProfile(userId);
    const isSubscribed = profile && (profile.monthly_credit_balance > 0);

    if (!isSubscribed) {
      throw new BadRequestException('Tính năng làm nét video (Upscale) chỉ dành cho tài khoản đã mua gói tháng. Vui lòng nâng cấp tài khoản của bạn để sử dụng.');
    }

    // 1.5. Check usage
    const usage = await this.usageService.checkUsage(userId);
    if (!usage.success) {
      throw new BadRequestException('Bạn đã hết lượt sử dụng. Vui lòng nâng cấp gói hoặc mua thêm.');
    }

    // 2. Increment usage to prevent spam
    await this.usageService.incrementUsage(userId);

    const modalUrl = this.configService.get<string>('MODAL_UPSCALE_URL');
    if (!modalUrl) {
      this.logger.error('MODAL_UPSCALE_URL is not configured');
      throw new InternalServerErrorException('Hệ thống AI chưa được cấu hình. Vui lòng liên hệ Admin.');
    }

    const jobId = `upscale_${Date.now()}_${userId.slice(0, 5)}`;
    let dbRecordId: string | null = null;

    try {
      // 3. Create a pending record in the database immediately so it persists across F5
      const { data: dbData, error: dbError } = await supabase
        .from('upscaled_videos')
        .insert({
          user_id: userId,
          video_url: videoUrl, // Use input URL temporarily
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

      // 4. Fire and forget! Process the upscale in the background
      this.processUpscaleInBackground(userId, dbRecordId!, videoUrl, jobId, modalUrl, originalFileName);

      // 5. Return success instantly to client
      return {
        success: true,
        message: 'Đã nhận yêu cầu làm nét. Tiến trình đang chạy ngầm.',
        id: dbRecordId || undefined
      };

    } catch (e: any) {
      this.logger.error(`Upscale initiation failed: ${e.message}`);

      // Update record to 'failed' in DB if it was created
      if (dbRecordId) {
        try {
          await supabase
            .from('upscaled_videos')
            .update({ status: 'failed' })
            .eq('id', dbRecordId);
        } catch (_) { }
      }

      throw new InternalServerErrorException('Không thể khởi tạo quá trình làm nét: ' + e.message);
    }
  }



  /**
   * Download video, extract audio track, scale DOWN video for faster GPU processing.
   *
   * Flow: 1080p input → extract audio (.aac) + scale video to 540p
   * GPU Real-ESRGAN 4x: 540p → 2160p (4K)
   * Post-GPU: mergeAudioIntoVideo() adds audio back → final output
   */
  private async transcodeForUpscale(
    videoUrl: string,
    jobId: string,
  ): Promise<{ videoBuffer: Buffer; audioBuffer: Buffer | null; tempPaths: string[] }> {
    const tmpDir = os.tmpdir();
    const tempInputPath = path.join(tmpDir, `input_${jobId}.mp4`);
    const tempVideoPath = path.join(tmpDir, `transcoded_${jobId}.mp4`);
    const tempAudioPath = path.join(tmpDir, `audio_${jobId}.aac`);

    this.logger.log(`[Transcode] Downloading input video for job ${jobId}...`);

    // 1. Download input video to temp file
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(`Failed to download video for transcode: HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(tempInputPath, Buffer.from(arrayBuffer));
    this.logger.log(`[Transcode] Input downloaded (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB).`);

    // 2. Extract audio track separately (to merge back after GPU upscale)
    let audioBuffer: Buffer | null = null;
    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg(tempInputPath)
          .outputOptions(['-vn', '-c:a aac', '-b:a 128k']) // video=none, audio=AAC 128k
          .output(tempAudioPath)
          .on('end', () => resolve())
          .on('error', (err: Error) => reject(err))
          .run();
      });
      if (fs.existsSync(tempAudioPath)) {
        audioBuffer = fs.readFileSync(tempAudioPath);
        this.logger.log(`[Transcode] Audio extracted: ${(audioBuffer.length / 1024).toFixed(0)} KB`);
      }
    } catch (audioErr: any) {
      this.logger.warn(`[Transcode] No audio track found (video may be silent): ${audioErr.message}`);
    }

    // 3. Normalize resolution (720p sweet spot, 540p fast or 1080p native) + strip audio
    let targetDimension = 1280; // default 'AI_UPSCALED_720P'
    if (this.WORKFLOW_MODE === 'AI_UPSCALED_540P') {
      targetDimension = 960;
    } else if (this.WORKFLOW_MODE === 'NATIVE_1080P') {
      targetDimension = 1920;
    }

    const scaleFilter = `scale='if(gt(iw,ih),min(${targetDimension},iw),-2)':'if(gt(iw,ih),-2,min(${targetDimension},ih))'`;

    await new Promise<void>((resolve, reject) => {
      ffmpeg(tempInputPath)
        .outputOptions([
          `-vf ${scaleFilter}`,    // Normalize to max 1080p longest side
          '-c:v libx264',          // H.264 standard format
          '-crf 20',               // High quality encoding
          '-preset fast',
          '-an',                   // Strip audio (processed separately)
          '-movflags +faststart',
        ])
        .output(tempVideoPath)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(new Error(`FFmpeg normalization failed: ${err.message}`)))
        .run();
    });

    const videoBuffer = fs.readFileSync(tempVideoPath);
    this.logger.log(`[Transcode] Video normalized (original 1080p/720p resolution preserved): ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);

    return { videoBuffer, audioBuffer, tempPaths: [tempInputPath, tempVideoPath, tempAudioPath] };
  }

  /**
   * Scale the GPU output video to exactly 1080p (Full HD) and merge audio back.
   * We do both scaling and audio-merging in a single FFmpeg pass for max efficiency.
   */
  private async mergeAudioIntoVideo(
    videoBuffer: Buffer,
    audioUrl: string | null,
    jobId: string,
  ): Promise<Buffer<ArrayBuffer>> {
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
        } else {
          this.logger.warn(`[Scale & Merge] Failed to download audio from ${audioUrl}: HTTP ${audioResponse.status}`);
        }
      } catch (audioErr: any) {
        this.logger.warn(`[Scale & Merge] Error fetching audio: ${audioErr.message}`);
      }
    }

    // High-performance Copy Mux: No scaling or re-encoding needed on BE CPU!
    // Video returned from GPU is already exactly 1080p (AI Upscaled).
    // Using '-c:v copy' enables instant muxing (< 0.1s) and 100% quality retention.
    await new Promise<void>((resolve, reject) => {
      let command = ffmpeg(tempVideoPath);

      const options = [
        '-c:v copy',
        '-movflags +faststart',
      ];

      if (hasAudio) {
        command = command.addInput(tempAudioPath);
        options.push(
          '-c:a aac',
          '-b:a 128k',
          '-shortest'
        );
      }

      command
        .outputOptions(options)
        .output(tempOutputPath)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(new Error(`FFmpeg scale/merge failed: ${err.message}`)))
        .run();
    });

    const finalBuffer = fs.readFileSync(tempOutputPath);
    this.logger.log(`[Scale & Merge] Completed. Final size: ${(finalBuffer.length / 1024 / 1024).toFixed(2)} MB`);

    // Cleanup temp files
    [tempVideoPath, tempAudioPath, tempOutputPath].forEach((p) => {
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) { }
    });

    return finalBuffer;
  }

  /**
   * Run the slow GPU upscaling call asynchronously in the background
   */
  private async processUpscaleInBackground(
    userId: string,
    dbRecordId: string,
    videoUrl: string,
    jobId: string,
    modalUrl: string,
    originalFileName?: string
  ): Promise<void> {
    const supabase = this.supabaseService.getAdminClient();
    this.logger.log(`[Background Job] Starting upscale for record ${dbRecordId} (Job: ${jobId})`);

    try {
      const webhookUrl = this.configService.get<string>('WEBHOOK_URL');

      // ── STEP 1: Extract audio + Scale DOWN video for GPU efficiency ────────
      this.logger.log(`[Background Job] Starting transcode step for job ${jobId}...`);
      let uploadUrl = videoUrl; // fallback to original if transcode fails
      let audioR2Url: string | null = null;
      let skipResize = false;

      try {
        const { videoBuffer, audioBuffer, tempPaths } =
          await this.transcodeForUpscale(videoUrl, jobId);

        // Clean up temp files
        tempPaths.forEach((p) => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) { } });

        // Upload scaled-down video to R2
        const transcodedFileName = `${userId}/transcoded_${jobId}.mp4`;
        uploadUrl = await this.uploadToR2(transcodedFileName, videoBuffer, 'video/mp4');
        this.logger.log(`[Background Job] Scaled video uploaded to R2: ${uploadUrl}`);

        // Upload extracted audio to R2 (will be merged back after GPU)
        if (audioBuffer && audioBuffer.length > 0) {
          const audioFileName = `${userId}/audio_${jobId}.aac`;
          audioR2Url = await this.uploadToR2(audioFileName, audioBuffer, 'audio/aac');
          this.logger.log(`[Background Job] Audio uploaded to R2: ${audioR2Url}`);
        }
        skipResize = true;
      } catch (transcodeErr: any) {
        this.logger.warn(`[Background Job] Transcode failed, using original video. Reason: ${transcodeErr.message}`);
        uploadUrl = videoUrl;
      }
      // ────────────────────────────────────────────────────────────────────────

      // Determine GPU outscale and mode dynamically based on WORKFLOW_MODE
      let outscale = '1.5';
      let mode = 'fast'; // Dùng RealESRGAN_x2plus (High-Fidelity) cho 720p để giữ tóc và mặt sắc nét nhất!

      if (this.WORKFLOW_MODE === 'AI_UPSCALED_540P') {
        outscale = '2';
        mode = 'quality'; // Dùng VGG realesr-general-x4v3 siêu tốc
      } else if (this.WORKFLOW_MODE === 'NATIVE_1080P') {
        outscale = '1';
        mode = 'fast';
      }

      const payload = {
        video_url: uploadUrl,
        job_id: jobId,
        skip_resize: skipResize,
        mode,
        outscale,
        // GPU sẽ upload trực tiếp lên R2 và gửi URL qua webhook (không dùng base64)
        r2_config: {
          account_id: this.configService.get<string>('R2_ACCOUNT_ID'),
          access_key_id: this.configService.get<string>('R2_ACCESS_KEY_ID'),
          secret_access_key: this.configService.get<string>('R2_SECRET_ACCESS_KEY'),
          bucket_name: this.configService.get<string>('R2_BUCKET_NAME') || 'tikviral',
          public_url_base: this.configService.get<string>('R2_PUBLIC_URL') || '',
          output_key: `${userId}/${jobId}.mp4`,
        },
        ...(webhookUrl ? {
          webhook_url: webhookUrl,
          metadata: { userId, dbRecordId, originalFileName }
        } : {})
      };

      // Check if job was already cancelled by the user during the transcode phase
      const { data: currentJob } = await supabase
        .from('upscaled_videos')
        .select('status')
        .eq('id', dbRecordId)
        .single();

      if (currentJob?.status === 'cancelled') {
        this.logger.log(`[Background Job] Job ${dbRecordId} was cancelled before spawning. Aborting.`);
        return;
      }

      // Update DB to Step 2 before calling Modal API
      await supabase
        .from('upscaled_videos')
        .update({ video_title: `${originalFileName || 'upscaled_video.mp4'}####[2/4] Đang kết nối và khởi động GPU AI Worker...##40` })
        .eq('id', dbRecordId);

      // ── STEP 2: Call Modal to spawn the GPU job ───────────────────────────
      const spawnData = await this.makeHttpsRequest(modalUrl, payload);
      if (!spawnData.call_id) {
        throw new Error(`Failed to spawn Modal worker: ${JSON.stringify(spawnData)}`);
      }

      // Save call_id AND audioUrl in DB (format: filename##callId##audioUrl##stepName##stepPercent)
      // audioUrl is retrieved later by webhook/polling to merge audio back
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

      // 2. Poll every 5 seconds until it completes or fails
      const statusUrl = modalUrl.replace('-enhance-video', '-get-status') + `?call_id=${spawnData.call_id}`;
      let data: any = null;
      const startTime = Date.now();
      const maxDuration = 35 * 60 * 1000; // 35 minutes limit (since animevideo is extremely fast, this is more than enough)

      while (Date.now() - startTime < maxDuration) {
        // Wait 5 seconds
        await new Promise((r) => setTimeout(r, 5000));

        // ✅ Check if job was cancelled in DB before polling Modal
        const { data: currentRecord } = await supabase
          .from('upscaled_videos')
          .select('status')
          .eq('id', dbRecordId)
          .single();

        if (currentRecord?.status === 'cancelled') {
          this.logger.log(`[Background Job] Job ${dbRecordId} was cancelled by user. Stopping polling loop.`);
          return; // ← exit cleanly, DB already marked as 'cancelled'
        }

        try {
          const pollRes = await this.makeHttpsRequest(statusUrl, null, 'GET');
          if (pollRes.status === 'done') {
            data = pollRes;
            break;
          } else if (pollRes.status === 'error') {
            throw new Error(`Modal AI Worker failed: ${pollRes.message}`);
          }
          this.logger.log(`[Background Job] Polling job ${jobId} status: ${pollRes.status || 'processing'}`);
        } catch (pollErr: any) {
          // If a minor network issue occurs, don't crash, just log and continue polling
          this.logger.warn(`[Background Job] Minor error polling job ${jobId}: ${pollErr.message}. Retrying...`);
        }
      }

      if (!data || data.status !== 'done' || !data.video_base64) {
        throw new Error('Upscaling job timed out or returned invalid format.');
      }

      // Update DB to Step 4 progress before starting merge
      await supabase
        .from('upscaled_videos')
        .update({ video_title: `${originalFileName || 'upscaled_video.mp4'}##${spawnData.call_id}##${audioR2Url || ''}##[4/4] Đang ghép nhạc & tối ưu chất lượng cuối...##90` })
        .eq('id', dbRecordId);

      // ── STEP 3: Decode GPU output, merge audio, upload final to R2 ─────────
      let finalVideoBuffer = Buffer.from(data.video_base64, 'base64');
      const fileName = `${userId}/${jobId}.mp4`;

      // Scale to 1080p and merge original audio back
      try {
        finalVideoBuffer = await this.mergeAudioIntoVideo(finalVideoBuffer, audioR2Url, jobId);
      } catch (mergeErr: any) {
        this.logger.warn(`[Background Job] Scale & audio merge failed. Reason: ${mergeErr.message}`);
      }

      const r2Url = await this.uploadToR2(fileName, finalVideoBuffer, 'video/mp4');

      // Update database record to 'completed'
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
      } else {
        this.logger.log(`[Background Job] Upscale record ${dbRecordId} successfully completed!`);

        // 3.5. Trừ thêm credit còn lại dựa trên thời gian xử lý video thực tế (mỗi phút trừ 1 credit, làm tròn lên, trừ đi 1 credit đã thu cọc lúc đầu)
        const durationSeconds = data.duration_seconds || 0;
        const totalCreditsNeeded = Math.ceil(durationSeconds / 60);
        const remainingCreditsToDeduct = totalCreditsNeeded - 1;

        if (remainingCreditsToDeduct > 0) {
          this.logger.log(`[Background Job] Video processed in ${durationSeconds}s. Charging ${totalCreditsNeeded} credits in total. Deducting remaining ${remainingCreditsToDeduct} credits for user ${userId}.`);
          await this.usageService.deductCredits(userId, remainingCreditsToDeduct);
        } else {
          this.logger.log(`[Background Job] Video processed in ${durationSeconds}s. Charged 1 credit deposit at start. No additional credits deducted.`);
        }
      }

    } catch (e: any) {
      this.logger.error(`[Background Job] Upscale execution failed for record ${dbRecordId}: ${e.message}`);

      // Update record to 'failed' in DB
      try {
        await supabase
          .from('upscaled_videos')
          .update({
            status: 'failed',
            video_title: originalFileName || 'upscaled_video.mp4'
          })
          .eq('id', dbRecordId);
        this.logger.log(`[Background Job] Updated upscale record ${dbRecordId} to 'failed' status`);
      } catch (dbErr: any) {
        this.logger.error(`[Background Job] Failed to mark upscale record as failed in DB: ${dbErr.message}`);
      }
    }
  }

  async uploadToR2(fileName: string, fileBuffer: Buffer, mimeType: string): Promise<string> {
    const accountId = this.configService.get<string>('R2_ACCOUNT_ID');
    const accessKeyId = this.configService.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('R2_SECRET_ACCESS_KEY');
    const bucketName = this.configService.get<string>('R2_BUCKET_NAME') || 'tikviral';
    const publicUrlBase = this.configService.get<string>('R2_PUBLIC_URL');

    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error('Cloudflare R2 is not fully configured with S3 credentials in environment variables');
    }

    const cleanFileName = fileName.replace(/\\/g, '/'); // Normalize path separators

    try {
      this.logger.log(`Uploading ${cleanFileName} (${fileBuffer.length} bytes) to Cloudflare R2 using S3 Client`);

      const s3Client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });

      await s3Client.send(new PutObjectCommand({
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
    } catch (e: any) {
      this.logger.error(`Cloudflare R2 Upload failed: ${e.message}`);
      throw new InternalServerErrorException(`Không thể tải file lên Cloudflare R2: ${e.message}`);
    }
  }

  /**
   * Xoa mot file tren R2 theo URL cong khai hoac R2 key.
   * Dung de don dep video tam sau khi Gemini da phan tich xong.
   */
  async deleteFromR2(r2Url: string): Promise<void> {
    const accountId = this.configService.get<string>('R2_ACCOUNT_ID');
    const accessKeyId = this.configService.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('R2_SECRET_ACCESS_KEY');
    const bucketName = this.configService.get<string>('R2_BUCKET_NAME') || 'tikviral';
    const publicUrlBase = this.configService.get<string>('R2_PUBLIC_URL') || '';

    if (!accountId || !accessKeyId || !secretAccessKey) {
      this.logger.warn('[R2 Delete] R2 not configured, skipping cleanup');
      return;
    }

    // Extract key from URL: remove the public base URL prefix
    let key = r2Url;
    const base = publicUrlBase.replace(/\/$/, '');
    if (base && key.startsWith(base + '/')) {
      key = key.slice(base.length + 1);
    } else {
      // Fallback: remove origin (https://domain.com/key)
      try {
        key = new URL(r2Url).pathname.replace(/^\//, '');
      } catch {
        this.logger.warn(`[R2 Delete] Cannot parse URL: ${r2Url}`);
        return;
      }
    }

    try {
      const s3Client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
      });

      await s3Client.send(new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      }));

      this.logger.log(`[R2 Delete] Deleted temp video: ${key}`);
    } catch (e: any) {
      // Log but don't throw — cleanup failure should not break the main flow
      this.logger.warn(`[R2 Delete] Failed to delete ${key}: ${e.message}`);
    }
  }

  async makeHttpsRequest(url: string, body: any, method: 'POST' | 'GET' = 'POST'): Promise<any> {
    return new Promise<any>((resolve, reject) => {
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
          } catch (err) {
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

  async handleUpscaleWebhook(payload: any): Promise<void> {
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

      if (!payload.video_url && !payload.video_base64) {
        throw new Error('Missing video_url or video_base64 in webhook payload');
      }

      // 1. Fetch DB record to retrieve stored audioUrl (saved as 3rd ## segment)
      const { data: dbRecord } = await supabase
        .from('upscaled_videos')
        .select('video_title')
        .eq('id', dbRecordId)
        .single();
      const titleParts = (dbRecord?.video_title || '').split('##');
      const audioR2Url = titleParts[2] || null;

      // Update DB to Step 4 progress before starting merge
      await supabase
        .from('upscaled_videos')
        .update({ video_title: `${originalFileName || 'upscaled_video.mp4'}##${jobId}##${audioR2Url || ''}##[4/4] Đang ghép nhạc & tối ưu chất lượng cuối...##90` })
        .eq('id', dbRecordId);

      // 2. Decode GPU output (hỗ trợ cả video_url lẫn video_base64 để tương thích)
      let finalVideoBuffer: Buffer;
      const fileName = `${userId}/${jobId}.mp4`;

      if (payload.video_url) {
        // GPU đã upload lên R2, file này có thể đã ở đúng vị trí rồi
        this.logger.log(`[Webhook] Nhận video_url từ GPU: ${payload.video_url}`);

        // Kiểm tra xem GPU đã upload đúng đường dẫn mị dũ chưa
        const expectedKey = `${userId}/${jobId}.mp4`;
        const publicBase = (this.configService.get<string>('R2_PUBLIC_URL') || '').replace(/\/$/, '');
        const expectedUrl = publicBase ? `${publicBase}/${expectedKey}` : '';

        if (expectedUrl && payload.video_url === expectedUrl) {
          // Tốt nhất: GPU đã upload đúng chỗ, chỉ cần merge audio nếu có
          if (audioR2Url) {
            this.logger.log(`[Webhook] Video đã trên R2 đúng vị trí, chỉ merge audio...`);
            const videoResponse = await fetch(payload.video_url);
            if (!videoResponse.ok) throw new Error(`Failed to download video from R2: HTTP ${videoResponse.status}`);
            finalVideoBuffer = Buffer.from(await videoResponse.arrayBuffer());
          } else {
            // Không có audio cần merge, file đã OK
            this.logger.log(`[Webhook] Video hoàn chỉnh trên R2, không cần merge audio. Cập nhật DB trực tiếp.`);
            const { error: dbUpdateError } = await supabase
              .from('upscaled_videos')
              .update({
                video_url: payload.video_url,
                video_title: originalFileName || 'upscaled_video.mp4',
                duration_seconds: payload.duration_seconds || null,
                size_mb: payload.size_mb || null,
                status: 'completed'
              })
              .eq('id', dbRecordId);

            if (dbUpdateError) {
              this.logger.error(`[Webhook] Failed to update record: ${dbUpdateError.message}`);
            } else {
              this.logger.log(`[Webhook] Upscale record ${dbRecordId} completed (no audio merge needed)!`);
              const durationSeconds = payload.duration_seconds || 0;
              const totalCreditsNeeded = Math.ceil(durationSeconds / 60);
              const remainingCreditsToDeduct = totalCreditsNeeded - 1;
              if (remainingCreditsToDeduct > 0) {
                await this.usageService.deductCredits(userId, remainingCreditsToDeduct);
              }
            }
            return; // Xong! Không cần upload lại
          }
        } else {
          // GPU upload đến đường dẫn khác, download về để merge audio rồi upload đúng chỗ
          const videoResponse = await fetch(payload.video_url);
          if (!videoResponse.ok) throw new Error(`Failed to download GPU video: HTTP ${videoResponse.status}`);
          finalVideoBuffer = Buffer.from(await videoResponse.arrayBuffer());
        }
      } else if (payload.video_base64) {
        // Fallback tương thích cũ: nhận base64 (video nhỏ)
        this.logger.log(`[Webhook] Nhận video_base64 (fallback mode)`);
        finalVideoBuffer = Buffer.from(payload.video_base64, 'base64');
      } else {
        throw new Error('Missing video_url or video_base64 in webhook payload');
      }

      // 3. Scale to 1080p and merge original audio back
      try {
        finalVideoBuffer = await this.mergeAudioIntoVideo(finalVideoBuffer, audioR2Url, jobId || dbRecordId);
      } catch (mergeErr: any) {
        this.logger.warn(`[Webhook] Scale & audio merge failed. Reason: ${mergeErr.message}`);
      }

      const r2Url = await this.uploadToR2(fileName, finalVideoBuffer, 'video/mp4');

      // 2. Update database record to 'completed'
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
      } else {
        this.logger.log(`[Webhook] Upscale record ${dbRecordId} successfully completed via Webhook!`);

        // 3. Deduct credit deposit remaining
        const durationSeconds = payload.duration_seconds || 0;
        const totalCreditsNeeded = Math.ceil(durationSeconds / 60);
        const remainingCreditsToDeduct = totalCreditsNeeded - 1;

        if (remainingCreditsToDeduct > 0) {
          this.logger.log(`[Webhook] Deducting remaining ${remainingCreditsToDeduct} credits for user ${userId}.`);
          await this.usageService.deductCredits(userId, remainingCreditsToDeduct);
        }
      }
    } catch (e: any) {
      this.logger.error(`[Webhook] Processing failed for record ${dbRecordId}: ${e.message}`);

      // Update record to 'failed' in DB
      try {
        await supabase
          .from('upscaled_videos')
          .update({
            status: 'failed',
            video_title: originalFileName || 'upscaled_video.mp4'
          })
          .eq('id', dbRecordId);
      } catch (dbErr: any) {
        this.logger.error(`[Webhook] Failed to mark upscale record as failed in DB: ${dbErr.message}`);
      }
    }
  }

  /**
   * Hủy tiến trình làm nét video đang chạy (không hoàn tiền)
   */
  async cancelUpscale(userId: string, dbRecordId: string): Promise<any> {
    const supabase = this.supabaseService.getAdminClient();
    this.logger.log(`[Cancel Job] Attempting to cancel upscale record ${dbRecordId} for user ${userId}`);

    try {
      // 1. Fetch record to verify ownership and state
      const { data: record, error: getError } = await supabase
        .from('upscaled_videos')
        .select('*')
        .eq('id', dbRecordId)
        .eq('user_id', userId)
        .single();

      if (getError || !record) {
        throw new BadRequestException('Không tìm thấy tiến trình làm nét.');
      }

      if (record.status !== 'pending') {
        throw new BadRequestException('Tiến trình làm nét đã kết thúc hoặc đã được hủy trước đó.');
      }

      // 2. Extract call_id from video_title
      const titleParts = (record.video_title || '').split('##');
      const cleanTitle = titleParts[0] || 'upscaled_video.mp4';
      const callId = titleParts[1];

      this.logger.log(`[Cancel Job] Extracted clean title: "${cleanTitle}", callId: "${callId || 'none'}"`);

      // 3. Update status in database immediately to 'cancelled'
      await supabase
        .from('upscaled_videos')
        .update({
          status: 'cancelled',
          video_title: cleanTitle
        })
        .eq('id', dbRecordId);

      // 4. Cancel the job on Modal if we have callId
      if (callId) {
        const modalUrl = this.configService.get<string>('MODAL_UPSCALE_URL');
        if (modalUrl) {
          const cancelUrl = modalUrl.replace('-enhance-video', '-cancel-job');
          this.logger.log(`[Cancel Job] Calling Modal cancel API: ${cancelUrl} for call_id: ${callId}`);
          try {
            await this.makeHttpsRequest(cancelUrl, { call_id: callId });
            this.logger.log(`[Cancel Job] Successfully sent cancel request to Modal.`);
          } catch (cancelErr: any) {
            this.logger.error(`[Cancel Job] Failed to request Modal cancellation for ${callId}: ${cancelErr.message}`);
          }
        }
      }

      return {
        success: true,
        message: 'Đã hủy tiến trình làm nét video thành công.'
      };
    } catch (e: any) {
      this.logger.error(`[Cancel Job] Failed to cancel job for record ${dbRecordId}: ${e.message}`);
      throw new InternalServerErrorException(e.message);
    }
  }

  /**
   * Fetch thông tin sản phẩm TikTok từ booking-api.tiktoday.vn
   * rồi dùng Gemini để tạo 10 hook affiliate chuyên nghiệp.
   */
  async generateProductHooks(productUrl: string, userId: string, useFallbackModel: boolean = false): Promise<{ result: string }> {
    if (!productUrl) {
      throw new BadRequestException('productUrl là bắt buộc.');
    }

    // Kiểm tra số dư (áp dụng cho tất cả credit/free usage)
    const usageCheck = await this.usageService.checkUsage(userId);
    if (!usageCheck?.success) {
      throw new BadRequestException('Bạn đã hết lượt sử dụng. Vui lòng nâng cấp gói hoặc nạp thêm credit.');
    }

    // 0. Chuẩn hóa URL sản phẩm (lấy ID và chuyển về dạng chuẩn https://www.tiktok.com/view/product/{id})
    let finalProductUrl = productUrl;
    try {
      const redirectRes = await fetch(productUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      const resolvedUrl = redirectRes.url || productUrl;
      const match = resolvedUrl.match(/\/(?:pdp|product)\/(\d+)/);
      if (match && match[1]) {
        finalProductUrl = `https://www.tiktok.com/view/product/${match[1]}`;
        this.logger.log(`[Hooks] Normalized product URL: ${productUrl} -> ${finalProductUrl}`);
      } else {
        finalProductUrl = resolvedUrl;
      }
    } catch (e: any) {
      this.logger.warn(`[Hooks] Failed to normalize product URL ${productUrl}: ${e.message}`);
    }

    // 1. Fetch product info từ SlideLabs API (ưu tiên)
    let productInfo: any = null;
    try {
      const slideLabsResponse = await fetch('https://api-v1.slidelabs.net/api/creator/import-product', {
        method: 'POST',
        headers: {
          'accept': 'application/json, text/plain, */*',
          'accept-language': 'vi,vi-VN;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5',
          'authorization': 'Bearer eyJhbGciOiJFZERTQSIsImtpZCI6ImU3MzU0ZWI1LWM4MjEtNDA4NC05ZGY2LWFhYzVkNWU5OGRlMiJ9.eyJpYXQiOjE3ODQ3MDc5NDgsIm5hbWUiOiJ0dWFuIGhvYW5nIiwiZW1haWwiOiJ0dWFuZ2luc2VuZzFAZ21haWwuY29tIiwiZW1haWxWZXJpZmllZCI6dHJ1ZSwiY3JlYXRlZEF0IjoiMjAyNi0wNy0xNVQwNDo0NTo0OC41ODNaIiwidXBkYXRlZEF0IjoiMjAyNi0wNy0xNVQwNDo0NTo0OC41ODNaIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJiYW5uZWQiOmZhbHNlLCJiYW5SZWFzb24iOm51bGwsImJhbkV4cGlyZXMiOm51bGwsImlkIjoiZjMwODQ3YmYtY2IzNS00M2M5LWE5NDMtZDU0ZDhlZjA4MmJmIiwic3ViIjoiZjMwODQ3YmYtY2IzNS00M2M5LWE5NDMtZDU0ZDhlZjA4MmJmIiwiZXhwIjoxNzg0NzA4ODQ4LCJpc3MiOiJodHRwczovL2VwLW9yYW5nZS10aHVuZGVyLWExNWVyNThsLm5lb25hdXRoLmFwLXNvdXRoZWFzdC0xLmF3cy5uZW9uLnRlY2giLCJhdWQiOiJodHRwczovL2VwLW9yYW5nZS10aHVuZGVyLWExNWVyNThsLm5lb25hdXRoLmFwLXNvdXRoZWFzdC0xLmF3cy5uZW9uLnRlY2gifQ.kSSeb9Gnlkjfqp7NhP4kPoHFVjB8wkHnliB64rF1wlrz-aP-BTm0Y3XhR2znHJsr3cjTgqfOkhN9--GrD4wvCA',
          'cache-control': 'no-cache',
          'content-type': 'application/json',
          'dnt': '1',
          'origin': 'https://www.slidelabs.net',
          'pragma': 'no-cache',
          'priority': 'u=1, i',
          'referer': 'https://www.slidelabs.net/',
          'sec-ch-ua': '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"macOS"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-site',
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
          'x-session-id': 'b3339841-e517-40be-8425-a7867aabf351',
          'Cookie': '__Secure-neon-auth.session_challange=72956f2f75af273863f45c1f5a5c16d942245662ae1ed0e736748835cd85ea89.yR1SUFPtt%2Fbpkyz27nZdDIcSN0swulj0QH8M2bZUSJg%3D; ph_phc_grwL1MkkuOhGrtuZ8GEa0n7ai6IzpzXjSlrPUerMS0N_posthog=%7B%22%24device_id%22%3A%22019f6417-a0b5-78c0-994b-3f05aa9b51e8%22%2C%22distinct_id%22%3A%22019f6417-a0b5-78c0-994b-3f05aa9b51e8%22%2C%22%24sesid%22%3A%5B1784708084073%2C%22019f88e1-f110-708c-8262-3d2e8215c8db%22%2C1784707936526%5D%2C%22%24initial_person_info%22%3A%7B%22r%22%3A%22%24direct%22%2C%22u%22%3A%22https%3A%2F%2Fwww.slidelabs.net%2F%22%7D%2C%22%24user_state%22%3A%22anonymous%22%7D'
        },
        body: JSON.stringify({ url: finalProductUrl }),
      });

      if (slideLabsResponse.ok) {
        const slideLabsData = await slideLabsResponse.json();
        if (slideLabsData && slideLabsData.productName) {
          productInfo = slideLabsData;
          this.logger.log(`[Hooks] Successfully fetched product info from SlideLabs for ${finalProductUrl}`);
        }
      }
    } catch (slideLabsError: any) {
      this.logger.warn(`[Hooks] SlideLabs API failed: ${slideLabsError.message}. Falling back to TikToday API.`);
    }

    if (!productInfo) {
      // Fallback: Fetch product info từ TikToday API
      try {
        const response = await fetch('https://booking-api.tiktoday.vn/api/v1/products/info', {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'content-type': 'application/json',
            'x-org-id': 'f999d0a0-9be2-4f36-80a8-2ed76cb0945c',
            'origin': 'https://booking.tiktoday.vn',
            'referer': 'https://booking.tiktoday.vn/',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
            'cookie': '_ga=GA1.1.1120479057.1783067130; token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NDY2OTUsIm5hbWUiOiJ0dWFuIGhvYW5nIiwiZW1haWwiOiJ0dWFuZ2luc2VuZzFAZ21haWwuY29tIiwicGhvbmUiOiIiLCJyb2xlIjoidXNlciIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJwaG9uZV92ZXJpZmllZCI6ZmFsc2UsImZpcmViYXNlX2lkIjoiRThQcWpnWktsR05Qd1QwMXc5M2ZuNGsySU8zMyIsImlzcyI6IlRpa1RvZGF5IiwiZXhwIjoxNzg1NjU5MjA3LCJpYXQiOjE3ODMwNjcyMDd9.VvgY_QYwkUQJVFUNcocb-W87gcARW7bThE8OOV5wHp8; _ga_9GE0BWBYXG=GS2.1.s1784512943$o5$g1$t1784513004$j59$l0$h0',
          },
          body: JSON.stringify({ url: finalProductUrl }),
        });

        if (!response.ok) {
          throw new BadRequestException(`Không thể lấy thông tin sản phẩm (HTTP ${response.status}). Vui lòng kiểm tra lại link sản phẩm.`);
        }

        const data = await response.json();
        productInfo = data;
      } catch (e: any) {
        await this.usageService.refundCredit(userId);
        if (e instanceof BadRequestException) throw e;
        throw new InternalServerErrorException('Lỗi khi lấy thông tin sản phẩm: ' + e.message);
      }
    }

    // 2. Build product info text
    const productInfoText = JSON.stringify(productInfo, null, 2);

    // 3. Build prompt
    const hookPrompt = `Bạn là chuyên gia viết kịch bản hook TikTok cho video affiliate (aff), được huấn luyện theo phương pháp luận của "Tikviral" — người có nhiều clip aff doanh số hơn 1 tỷ đồng. Nhiệm vụ của bạn: dựa vào thông tin sản phẩm dưới đây, tạo ra 20 HOOK (câu mở đầu video) khác nhau để người dùng quay video TikTok bán hàng.

# THÔNG TIN SẢN PHẨM
${productInfoText}

# NGUYÊN TẮC BẮT BUỘC KHI TẠO HOOK

## 1. Công thức gốc: "1 câu + 1 target + 1 insight"
Mỗi hook phải nêu được TRONG 1 CÂU: một tập khách hàng cụ thể (target) + nỗi đau/nhu cầu của họ (insight), gắn liền với sản phẩm. Lý do: trên TikTok Shop, video ăn theo quảng cáo/AI phân phối chứ không ăn may viral — hook càng chỉ rõ "ai nên xem" thì AI càng phân phối đúng người, tỷ lệ ra đơn càng cao.

## 2. Chấm điểm độ "niche" (độ cụ thể) — chỉ chọn hook đạt 7-10 điểm
Target + insight càng cụ thể càng ăn điểm. Thang tham khảo:
- 1 điểm: chung chung ("mọi người mua đi")
- 3 điểm: có giới tính ("mấy ông nam mua đi")
- 5 điểm: có thêm hành vi/đặc điểm ("mấy ông nam hay bị X mua đi")
- 7 điểm: có thêm tần suất/mức độ cụ thể
- 10 điểm: kết hợp đủ 6 yếu tố — Giới tính, Độ tuổi, Khu vực, Công việc, Hành vi, Nhu cầu — trong một câu tự nhiên, không gượng ép

Với mỗi hook bạn tạo, tự chấm điểm độ niche (thang 1-10) và chỉ giữ lại nếu đạt từ 7 trở lên. Nếu thông tin sản phẩm không đủ dữ kiện để lên tới 10 điểm thì cứ tối ưu hết mức có thể trong giới hạn dữ liệu.

## 3. Áp dụng khung "5 chỉ số vàng" — đặc biệt là Hook 3 giây đầu
Hook là để vượt qua bộ lọc 3 giây đầu, phải kích thích thị giác/tò mò ngay lập tức. Với mỗi hook, ngoài câu thoại, hãy gợi ý 1 HÀNH ĐỘNG HÌNH ẢNH đi kèm (chuyển động nhanh, đạo cụ, biểu cảm...) để giữ chân người xem — không lướt qua.
Đồng thời, nội dung hook nên gợi mở khả năng: được Like (đồng cảm/giải trí), được Comment (câu hỏi lửng/gây tranh luận), được Lưu (có giá trị dùng lại) hoặc được Share (nói trúng nỗi lòng số đông) — miễn phù hợp với sản phẩm.

## 4. Đa dạng hoá theo 7 nhóm tâm lý hook
Phân bổ 20 hook trải đều qua các nhóm sau, chọn nhóm phù hợp với đặc tính sản phẩm:
1. Gây Tò Mò & Bí Mật — tiết lộ điều ít ai biết, tạo vòng lặp xem lại
2. Kích Tranh Luận — đưa quan điểm trái chiều về cách dùng/lựa chọn sản phẩm
3. Chứng Minh Kết Quả — khoe kết quả trước/sau, so sánh giá trị
4. Giáo Dục Chuyên Môn — mẹo/kiến thức liên quan đến sản phẩm, hoặc "cách lười" để đạt kết quả
5. Đánh Vào Nỗi Sợ — cảnh báo hậu quả nếu không dùng/không biết
6. Kể Chuyện & Đồng Cảm — trải nghiệm cá nhân, thú nhận, câu chuyện trước-sau
7. Lọc Đúng Khách Hàng — gọi thẳng tên tập khách ("Nếu bạn là...")

Viết hook bằng tiếng Việt tự nhiên, giọng nói thật (như người thật đang nói trước camera), KHÔNG dịch máy, KHÔNG sáo rỗng, KHÔNG vi phạm chính sách quảng cáo TikTok (không cam kết y tế/hiệu quả tuyệt đối, không dùng từ cấm như "chữa khỏi", "đảm bảo 100%"...).

# ĐỊNH DẠNG OUTPUT
Trả lời DUY NHẤT một JSON hợp lệ, không thêm text ngoài JSON, theo cấu trúc:

{
  "product_name": "tên sản phẩm",
  "hooks": [
    {
      "id": 1,
      "category": "một trong 7 nhóm ở trên",
      "target_audience": "mô tả tập khách hàng cụ thể",
      "insight": "nỗi đau/nhu cầu cụ thể của tập khách này",
      "niche_score": 8,
      "hook_text": "câu hook hoàn chỉnh, tự nhiên, sẵn sàng đọc trước camera",
      "visual_action": "hành động/đạo cụ hình ảnh gợi ý cho 3 giây đầu",
      "psychological_trigger": "tên cơ chế tâm lý đang khai thác"
    }
  ]
}`;

    // 4. Lấy model đã cài đặt trong DB và gọi Gemini
    try {
      const settings = await this.geminiService.getSettingsFromDb();
      const parts = [{ text: hookPrompt }];
      const modelToUse = useFallbackModel ? FALLBACK_MODEL : settings.model;
      const result = await this.geminiService.generateContent(parts, modelToUse);
      
      // Sau khi tạo hook thành công: trừ lượt dùng của user (credit hoặc lượt miễn phí)
      await this.usageService.incrementUsage(userId).catch(err =>
        this.logger.warn(`[Hooks] Failed to increment usage for ${userId}: ${err.message}`)
      );
      
      return result;
    } catch (e: any) {
      // Lỗi xảy ra trước khi incrementUsage được gọi, nên không cần hoàn credit
      throw e;
    }
  }
}
