import { Injectable, InternalServerErrorException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsageService } from '../usage/usage.service';
import { SupabaseService } from '../supabase/supabase.service';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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
        } catch (_) {}
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
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
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
        tempPaths.forEach((p) => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {} });

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

      if (!payload.video_base64) {
        throw new Error('Missing video_base64 in webhook payload');
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
}
