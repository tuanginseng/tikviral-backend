import { Injectable, InternalServerErrorException, BadRequestException, ConflictException, NotFoundException, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { SupabaseService } from '../supabase/supabase.service';
import { TelegramService } from '../telegram/telegram.service';
import * as crypto from 'crypto';


const MAX_DAILY_USAGE = 250;
const FALLBACK_MODEL = "gemini-3.1-flash-lite";
const MAX_ATTEMPTS = 2;

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly telegramService: TelegramService,
  ) { }


  async proxyRequest(dto: any) {
    const { action, apiKeyToTest } = dto;
    let geminiApiKey: string | null = null;

    if (action === 'testApiKey' || action === 'getAvailableModels') {
      if (!apiKeyToTest) throw new BadRequestException('API Key is required for this action.');
      geminiApiKey = apiKeyToTest;
    } else {
      throw new BadRequestException(`Invalid Gemini action for proxy: ${action}.`);
    }

    let modelUsed: string | null = null;
    let responseData: any;

    try {
      if (action === 'testApiKey') {
        const testGenAI = new GoogleGenerativeAI(apiKeyToTest);
        const testModel = testGenAI.getGenerativeModel({ model: "gemini-pro" });
        const result = await testModel.generateContent("Hello, can you hear me?");
        responseData = result.response.text();
        modelUsed = "gemini-pro";
      } else if (action === 'getAvailableModels') {
        const modelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKeyToTest}`);
        if (!modelsRes.ok) throw new Error(`HTTP error! status: ${modelsRes.status}`);
        const data = await modelsRes.json();
        responseData = data.models?.filter((model: any) =>
          model.supportedGenerationMethods?.includes('generateContent')
        ) || [];
      }

      return { result: responseData, modelUsed };
    } catch (error: any) {
      this.logger.error('Error in gemini proxy:', error.message);
      throw new InternalServerErrorException('Failed to process Gemini request', error.message);
    }
  }

  async manageApiKeys(action: string, payload: any) {
    const admin = this.supabaseService.getAdminClient();
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    const { key_id, api_key, is_active, offset = 0, limit = 10, order } = payload;

    switch (action) {
      case 'get-all-keys': {
        let query = admin.from('gemini_api_keys').select('*', { count: 'exact' });
        if (order && Array.isArray(order)) {
          order.forEach((opt: any) => { query = query.order(opt.column, { ascending: opt.ascending }); });
        } else {
          query = query.order('is_active', { ascending: false }).order('created_at', { ascending: true });
        }
        const { data, count, error } = await query.range(offset, offset + limit - 1);
        if (error) throw new InternalServerErrorException(error.message);
        return { keys: data || [], totalCount: count || 0 };
      }
      case 'add-key': {
        if (!api_key) throw new BadRequestException('API key required');
        const { data, error } = await admin.from('gemini_api_keys').insert({ api_key: api_key.trim(), daily_usage_count: 0, last_reset_date: today }).select();
        if (error) {
          if (error.code === '23505') throw new ConflictException('API Key already exists');
          throw new InternalServerErrorException(error.message);
        }
        return { message: 'API Key added successfully', key: data[0] };
      }
      case 'update-key': {
        if (!key_id || !api_key) throw new BadRequestException('Key ID and API key required');
        const { data, error } = await admin.from('gemini_api_keys').update({ api_key: api_key.trim() }).eq('id', key_id).select();
        if (error) {
          if (error.code === '23505') throw new ConflictException('API Key already exists');
          throw new InternalServerErrorException(error.message);
        }
        if (!data || data.length === 0) throw new NotFoundException('Key not found');
        return { message: 'API Key updated successfully', key: data[0] };
      }
      case 'delete-key': {
        if (!key_id) throw new BadRequestException('Key ID required');
        const { error } = await admin.from('gemini_api_keys').delete().eq('id', key_id);
        if (error) throw new InternalServerErrorException(error.message);
        return { message: 'API Key deleted successfully' };
      }
      case 'toggle-key-status': {
        if (!key_id || typeof is_active !== 'boolean') throw new BadRequestException('Key ID and is_active required');
        const { data, error } = await admin.from('gemini_api_keys').update({ is_active, last_used_at: now.toISOString() }).eq('id', key_id).select();
        if (error) throw new InternalServerErrorException(error.message);
        if (!data || data.length === 0) throw new NotFoundException('Key not found');

        // Tự động reset nếu không còn key nào active
        let autoReset = false;
        if (!is_active) {
          const { count, error: countError } = await admin
            .from('gemini_api_keys')
            .select('*', { count: 'exact', head: true })
            .eq('is_active', true)
            .neq('id', '00000000-0000-0000-0000-000000000000');

          if (!countError && count === 0) {
            // Không còn key nào được bật -> Reset toàn bộ
            const { error: resetError } = await admin
              .from('gemini_api_keys')
              .update({
                is_active: true,
                rate_limited_until: null,
                daily_usage_count: 0,
                last_reset_date: today
              })
              .neq('id', '00000000-0000-0000-0000-000000000000');

            if (!resetError) {
              autoReset = true;
            }
          }
        }

        return {
          message: autoReset ? 'Tất cả API Key đã bị tắt nên hệ thống đã tự động reset và bật lại tất cả.' : 'Cập nhật trạng thái thành công',
          key: data[0],
          autoReset
        };
      }
      case 'get-total-usage': {
        const { data, error } = await admin.from('gemini_api_keys').select('daily_usage_count').eq('last_reset_date', today);
        if (error) throw new InternalServerErrorException(error.message);
        const total = (data || []).reduce((sum, key) => sum + key.daily_usage_count, 0);
        return { total_usage: total };
      }
      case 'reset-all-keys': {
        const { data, error } = await admin.from('gemini_api_keys').update({ rate_limited_until: null, is_active: true }).neq('id', '00000000-0000-0000-0000-000000000000').select();
        if (error) throw new InternalServerErrorException(error.message);
        return { message: 'All API Keys reset', count: data?.length || 0 };
      }
      case 'get-active-key-internal': {
        const { apiKey, keyId } = await this.getActiveKeyInternal();
        return { apiKey, keyId };
      }
      case 'report-rate-limit': {
        const { key_id } = payload;
        if (!key_id) throw new BadRequestException('key_id required');
        await this.reportRateLimit(key_id);
        return { message: `Key ${key_id} marked as rate-limited` };
      }
      default:
        throw new BadRequestException('Invalid action');
    }
  }

  async getActiveKeyInternal(): Promise<{ apiKey: string, keyId: string }> {
    const admin = this.supabaseService.getAdminClient();
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    let { data: activeKey, error } = await admin
      .from('gemini_api_keys')
      .select('*')
      .eq('is_active', true)
      .or(`rate_limited_until.is.null,rate_limited_until.lt.${now.toISOString()}`)
      .order('last_used_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);

    let keyToReturn = null;

    if (activeKey) {
      let newDailyUsageCount = activeKey.daily_usage_count;
      let newLastResetDate = activeKey.last_reset_date;
      let newIsActive = activeKey.is_active;
      let newRateLimitedUntil = activeKey.rate_limited_until;

      if (newLastResetDate !== today) {
        newDailyUsageCount = 0;
        newLastResetDate = today;
      }
      newDailyUsageCount++;

      if (newDailyUsageCount > MAX_DAILY_USAGE) {
        newIsActive = false;
        const nowUtc = new Date();
        let nextResetTimeUtc = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate(), 2, 0, 0, 0));
        if (nextResetTimeUtc.getTime() <= nowUtc.getTime()) nextResetTimeUtc.setUTCDate(nextResetTimeUtc.getUTCDate() + 1);
        newRateLimitedUntil = nextResetTimeUtc.toISOString();
      }

      const { data: updatedKey, error: updateError } = await admin
        .from('gemini_api_keys')
        .update({ is_active: newIsActive, rate_limited_until: newRateLimitedUntil, last_used_at: now.toISOString(), daily_usage_count: newDailyUsageCount, last_reset_date: newLastResetDate })
        .eq('id', activeKey.id)
        .select()
        .single();

      if (updateError) throw new InternalServerErrorException(updateError.message);

      if (updatedKey.is_active) {
        keyToReturn = updatedKey;
      } else {
        // Key vừa bị tắt do hết quota ngày — gửi thông báo Telegram
        this.telegramService.sendAlert(
          'Gemini API Key bị vô hiệu hóa',
          `Key ID: ${activeKey.id.slice(0, 8)}...\nLý do: Đạt giới hạn ${MAX_DAILY_USAGE} lượt/ngày.\nHệ thống sẽ tự động chuyển sang key khác.`,
          '🔴',
        ).catch(() => {}); // Fire-and-forget, không block luồng chính
        throw new BadRequestException('Key hit daily limit, please retry to get another key.');
      }

    }

    if (!keyToReturn) {
      const { data: expiredKey, error: expiredError } = await admin
        .from('gemini_api_keys')
        .select('*')
        .eq('is_active', false)
        .not('rate_limited_until', 'is', null)
        .lt('rate_limited_until', now.toISOString())
        .order('last_used_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (expiredError) throw new InternalServerErrorException(expiredError.message);

      if (expiredKey) {
        const { data: reactivatedKey, error: reactivateError } = await admin
          .from('gemini_api_keys')
          .update({ is_active: true, rate_limited_until: null, last_used_at: now.toISOString(), daily_usage_count: 1, last_reset_date: today })
          .eq('id', expiredKey.id)
          .select()
          .single();

        if (reactivateError) throw new InternalServerErrorException(reactivateError.message);
        keyToReturn = reactivatedKey;
      }
    }

    // Nếu vẫn không có key nào (tất cả đang bị rate limit chưa tới giờ, hoặc bị tắt hết)
    // Tự động reset lại toàn bộ keys và bật lên lại
    if (!keyToReturn) {
      const { data: resetKeys, error: resetError } = await admin
        .from('gemini_api_keys')
        .update({
          is_active: true,
          rate_limited_until: null,
          last_used_at: now.toISOString(),
          daily_usage_count: 0,
          last_reset_date: today
        })
        .neq('id', '00000000-0000-0000-0000-000000000000') // Bỏ qua system key nếu có
        .select();

      if (resetError) throw new InternalServerErrorException(resetError.message);

      if (resetKeys && resetKeys.length > 0) {
        keyToReturn = resetKeys[0];
        console.log(`[GeminiService] Auto-reset ${resetKeys.length} keys because all were inactive/rate-limited.`);
      }
    }

    if (keyToReturn) {
      return { apiKey: keyToReturn.api_key, keyId: keyToReturn.id };
    } else {
      throw new InternalServerErrorException('No available Gemini API keys. Database might be empty.');
    }
  }

  async reportRateLimit(keyId: string) {
    const admin = this.supabaseService.getAdminClient();
    const nowUtc = new Date();
    let nextResetTimeUtc = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate(), 2, 0, 0, 0));
    if (nextResetTimeUtc.getTime() <= nowUtc.getTime()) nextResetTimeUtc.setUTCDate(nextResetTimeUtc.getUTCDate() + 1);

    await admin.from('gemini_api_keys').update({ is_active: false, rate_limited_until: nextResetTimeUtc.toISOString() }).eq('id', keyId);

    // Gửi thông báo Telegram khi key bị rate-limited
    this.telegramService.sendAlert(
      'Gemini API Key bị Rate Limited',
      `Key ID: ${keyId.slice(0, 8)}...\nLý do: Google trả về lỗi 429 (quá giới hạn tốc độ).\nKey sẽ tự động kích hoạt lại lúc ${nextResetTimeUtc.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}.`,
      '⚠️',
    ).catch(() => {}); // Fire-and-forget
  }


  /**
   * Gọi Gemini AI hoàn toàn server-side - API key không bao giờ ra ngoài.
   * Frontend gửi parts (text, inlineData base64) lên, backend tự lấy key và gọi Gemini.
   */
  async generateContent(parts: any[], model?: string): Promise<{ result: string; modelUsed: string }> {
    if (!parts || !Array.isArray(parts) || parts.length === 0) {
      throw new BadRequestException('parts array is required');
    }

    let apiKeyObj: { apiKey: string; keyId: string };
    try {
      apiKeyObj = await this.getActiveKeyInternal();
    } catch (e: any) {
      throw new InternalServerErrorException('Không thể lấy API key Gemini từ hệ thống.');
    }

    let { apiKey: geminiApiKey, keyId: geminiKeyId } = apiKeyObj;

    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const { GoogleAIFileManager } = require('@google/generative-ai/server');
    const fileManager = new GoogleAIFileManager(geminiApiKey);
    let tempFilePath: string | null = null;
    let uploadedFileName: string | null = null;

    try {
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]._uploadBuffer) {
          tempFilePath = path.join(os.tmpdir(), `gemini-upload-${Date.now()}-${Math.floor(Math.random() * 1000)}.mp4`);
          fs.writeFileSync(tempFilePath, parts[i]._uploadBuffer);
          const uploadResult = await fileManager.uploadFile(tempFilePath, {
            mimeType: parts[i].mimeType || 'video/mp4',
            displayName: 'video'
          });
          uploadedFileName = uploadResult.file.name;

          let file = await fileManager.getFile(uploadedFileName);
          while (file.state === 'PROCESSING' || file.state === 'STATE_UNSPECIFIED') {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            file = await fileManager.getFile(uploadedFileName);
          }
          if (file.state !== 'ACTIVE') {
            throw new Error('Xử lý video trên Google AI thất bại: ' + file.state);
          }

          parts[i] = { fileData: { fileUri: uploadResult.file.uri, mimeType: uploadResult.file.mimeType } };
        }
      }
    } catch (err: any) {
      require('fs').writeFileSync('/tmp/tikviral_error.log', 'Upload Error: ' + (err.stack || err.message));
      if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      throw new InternalServerErrorException('Lỗi upload video lên Google AI: ' + err.message);
    }

    const modelName = model || 'gemini-2.5-flash-lite';
    let currentModel = modelName;
    let attempts = 0;
    let finalResult: { result: string; modelUsed: string } | null = null;

    try {
      while (attempts < MAX_ATTEMPTS) {
        try {
          const genAI = new GoogleGenerativeAI(geminiApiKey);
          this.logger.log(`Đang sử dụng model Gemini: ${currentModel} (Lần thử: ${attempts + 1}/${MAX_ATTEMPTS})`);
          const geminiModel = genAI.getGenerativeModel({ model: currentModel });
          const result = await geminiModel.generateContent(parts);
          const responseText = result.response.text();

          if (!responseText || responseText.trim().length === 0) {
            throw new InternalServerErrorException('AI trả về kết quả rỗng.');
          }

          finalResult = { result: responseText, modelUsed: currentModel };
          break;
        } catch (error: any) {
          const errorMessage = error.message || error.toString();
          if (errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('429')) {
            await this.reportRateLimit(geminiKeyId);
            if (attempts < MAX_ATTEMPTS - 1) {
              this.logger.warn(`API Key hết hạn mức, hệ thống đang tự động lấy key mới và thử fallback: ${FALLBACK_MODEL}`);
              try {
                const newKeyObj = await this.getActiveKeyInternal();
                geminiApiKey = newKeyObj.apiKey;
                geminiKeyId = newKeyObj.keyId;
              } catch (e) {
                throw new InternalServerErrorException('Tất cả API Key đều đã hết lượt sử dụng. Vui lòng thử lại sau.');
              }
              currentModel = FALLBACK_MODEL;
              attempts++;
              continue;
            } else {
              throw new InternalServerErrorException('API Key đã đạt giới hạn sử dụng. Vui lòng thử lại sau ít phút.');
            }
          } else if (
            errorMessage.includes('503') ||
            errorMessage.includes('overloaded') ||
            errorMessage.includes('404') // Model không tồn tại → fallback
          ) {
            if (attempts < MAX_ATTEMPTS - 1) {
              this.logger.warn(`[Model] "${currentModel}" lỗi (${errorMessage}), thử fallback: ${FALLBACK_MODEL}`);
              currentModel = FALLBACK_MODEL;
              attempts++;
              continue;
            } else {
              throw new InternalServerErrorException(`Model không khả dụng hoặc quá tải. Vui lòng thử lại sau. (${errorMessage})`);
            }
          } else {
            require('fs').writeFileSync('/tmp/tikviral_full_error.log', 'Full error: ' + error.stack);
            throw new InternalServerErrorException(errorMessage);
          }
        }
      }
    } finally {
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch (e) { }
      }
      if (uploadedFileName) {
        try { await fileManager.deleteFile(uploadedFileName); } catch (e) { }
      }
    }

    if (finalResult) return finalResult;
    throw new InternalServerErrorException('Thất bại sau nhiều lần thử.');
  }

  /**
   * Thực hiện task AI hoàn toàn server-side.
   * Frontend chỉ gửi data thô + tên task.
   * Prompt được build tại đây, không bao giờ lộ ra ngoài.
   */
  async executeTask(dto: {
    task: string;
    userId?: string;
    // Phân tích video
    videoData?: string;
    videoUrl?: string;
    mimeType?: string;
    metrics?: { play_count?: number; digg_count?: number; comment_count?: number; share_count?: number };
    isViral?: 'viral' | 'not-viral' | null;
    // Violation appeal
    imageData?: string;
    imageMimeType?: string;
    userMessage?: string;
    // Script / Title
    analysisResult?: string;
    transcript?: string;
    hookType?: string;
    scriptContent?: string;
    titleType?: string;
    // Text generation
    textPromptKey?: string; // key để lấy system prompt từ DB
    userText?: string;
  }): Promise<{ result: string }> {
    try {
      const settings = await this.getSettingsFromDb();
      let parts: any[];

      switch (dto.task) {
        case 'analyze-video': {
          if (!dto.videoData && !dto.videoUrl) throw new BadRequestException('videoData or videoUrl required');

          // Security check: Uploaded video (videoData) requires Monthly 90 package
          if (dto.videoData && !dto.videoUrl) {
            if (!dto.userId) {
              throw new BadRequestException('Chức năng tải video lên yêu cầu đăng nhập và gói 90 lượt.');
            }

            const admin = this.supabaseService.getAdminClient();
            const { data: usage, error: usageError } = await admin.rpc('check_usage_only', {
              p_user_id: dto.userId
            });

            if (usageError || !usage || usage.monthly_credits <= 0) {
              throw new BadRequestException('Chức năng tải video lên chỉ dành cho người dùng đăng ký gói 90 lượt.');
            }
          }

          let videoPart;
          if (dto.videoUrl) {
            let response;
            try {
              response = await fetch(dto.videoUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                  'Referer': 'https://www.tiktok.com/',
                }
              });
              if (!response.ok) throw new BadRequestException('Cannot fetch video from videoUrl: ' + response.status);
            } catch (e: any) {
              require('fs').writeFileSync('/tmp/tikviral_error.log', 'Fetch Error: ' + (e.stack || e.message));
              throw e;
            }
            const buffer = await response.arrayBuffer();
            const mimeType = response.headers.get('content-type') || 'video/mp4';
            videoPart = { _uploadBuffer: Buffer.from(buffer), mimeType };
          } else {
            if (!dto.mimeType || !dto.videoData) throw new BadRequestException('mimeType and videoData required');
            const buffer = Buffer.from(dto.videoData!.replace(/^data:.*?;base64,/, ''), 'base64');
            videoPart = { _uploadBuffer: buffer, mimeType: dto.mimeType };
          }

          const m = dto.metrics;
          const stats = `- Lượt xem: ${m?.play_count?.toLocaleString() || 'N/A'}\n- Lượt thích: ${m?.digg_count?.toLocaleString() || 'N/A'}\n- Bình luận: ${m?.comment_count?.toLocaleString() || 'N/A'}\n- Chia sẻ: ${m?.share_count?.toLocaleString() || 'N/A'}`;
          let prompt = stats + '\n\n' + settings.systemPrompt;
          if (m?.play_count !== undefined && m.play_count < 50000 && !dto.isViral) {
            prompt += `\n\n**LƯU Ý:** Video chưa viral (${stats}). Hãy phân tích tại sao và đưa ra gợi ý cải thiện.`;
          } else if (dto.isViral === 'not-viral') {
            prompt += `\n\n**LƯU Ý:** Video được chỉ định là CHƯA VIRAL. Hãy phân tích tại sao và gợi ý cải thiện.`;
          } else if (dto.isViral === 'viral') {
            prompt += `\n\n**LƯU Ý:** Video được chỉ định là ĐÃ VIRAL. Phân tích yếu tố giúp viral.`;
          }
          parts = [videoPart, { text: prompt }];
          break;
        }
        case 'analyze-violation': {
          if (!dto.imageData || !dto.imageMimeType) throw new BadRequestException('imageData and imageMimeType required');
          parts = [
            { inlineData: { data: dto.imageData, mimeType: dto.imageMimeType } },
            { text: settings.violationAppealPrompt },
            { text: dto.userMessage || '' },
          ];
          break;
        }
        case 'extract-script': {
          if (!dto.videoData && !dto.videoUrl) throw new BadRequestException('videoData or videoUrl required');

          let videoPart;
          if (dto.videoUrl) {
            let response;
            try {
              response = await fetch(dto.videoUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                  'Referer': 'https://www.tiktok.com/',
                }
              });
              if (!response.ok) throw new BadRequestException('Cannot fetch video from videoUrl: ' + response.status);
            } catch (e: any) {
              require('fs').writeFileSync('/tmp/tikviral_error.log', 'Fetch Error 2: ' + (e.stack || e.message));
              throw e;
            }
            const buffer = await response.arrayBuffer();
            const mimeType = response.headers.get('content-type') || 'video/mp4';
            videoPart = { _uploadBuffer: Buffer.from(buffer), mimeType };
          } else {
            if (!dto.mimeType || !dto.videoData) throw new BadRequestException('mimeType and videoData required');
            const buffer = Buffer.from(dto.videoData!.replace(/^data:.*?;base64,/, ''), 'base64');
            videoPart = { _uploadBuffer: buffer, mimeType: dto.mimeType };
          }

          const extractPrompt = `Trích xuất tất cả lời thoại, văn bản, và nội dung âm thanh từ video này. Bao gồm:\n\n**LỜI THOẠI/VOICE-OVER:**\n[Tất cả lời nói]\n\n**TEXT TRÊN MÀN HÌNH:**\n[Văn bản xuất hiện]\n\n**NỘI DUNG CHÍNH:**\n[Mô tả chi tiết]\n\n**ÂM THANH/NHẠC:**\n[Mô tả âm thanh]`;
          parts = [videoPart, { text: extractPrompt }];
          break;
        }
        case 'create-script': {
          if (!dto.analysisResult) throw new BadRequestException('analysisResult required');
          // Hook + script prompt đơn giản — chi tiết hơn có thể lưu vào DB sau
          const scriptPrompt = this.buildScriptPrompt(dto.analysisResult, dto.transcript || null, dto.hookType || null);
          parts = [{ text: scriptPrompt }];
          break;
        }
        case 'generate-title': {
          if (!dto.scriptContent || !dto.titleType) throw new BadRequestException('scriptContent and titleType required');
          const titlePrompt = this.buildTitlePrompt(dto.scriptContent, dto.titleType);
          parts = [{ text: titlePrompt }];
          break;
        }
        case 'generate-text': {
          if (!dto.userText) throw new BadRequestException('userText required');
          const sysPrompt = dto.textPromptKey ? (settings as any)[dto.textPromptKey] || '' : '';
          parts = sysPrompt ? [{ text: sysPrompt }, { text: dto.userText }] : [{ text: dto.userText }];
          break;
        }
        default:
          throw new BadRequestException('Unknown task: ' + dto.task);
      }

      return await this.generateContent(parts, settings.model);
    } catch (e: any) {
      require('fs').writeFileSync('/tmp/tikviral_fatal.log', 'Fatal Error: ' + (e.stack || e.message));
      throw e;
    }
  }

  private buildScriptPrompt(
    analysisResult: string,
    transcript: string | null,
    hookType: string | null,
    isShoppable: boolean = false // Thêm tham số từ FE
  ): string {
    const transcriptSection = transcript
      ? `\n\n**TRANSCRIPT GỐC:**\n${transcript}`
      : '';

    const hookSection = hookType
      ? `\n\n**YÊU CẦU HOOK:** Sử dụng kiểu hook "${hookType}" cho scene đầu tiên.`
      : '';

    // Tối ưu phần Insight thành Rule cho AI
    const shoppableSection = isShoppable
      ? `\n\n**YÊU CẦU ĐẶC BIỆT DÀNH CHO VIDEO GẮN GIỎ HÀNG (TIKTOK SHOP):**
- KHÔNG review sản phẩm một cách trực diện và khô khan (VD: không dùng "Đây là sản phẩm X, có tính năng Y").
- BẮT BUỘC áp dụng công thức: [Nỗi tự ti/Vấn đề thực tế] + [Giải pháp cụ thể] + [Tính ứng dụng đời sống].
- Video phải bán "cảm giác được giải quyết vấn đề" trước khi bán sản phẩm. 
- Mở đầu video phải đi thẳng vào một insight: Khán giả đang tự ti điều gì, sợ điều gì, hoặc gặp rắc rối gì trong đời sống? (Ví dụ: Sợ xót tiền khi rơi vỡ màn hình điện thoại, dán kính cường lực hay bị bọt khí, tay vụng về không tự dán được...).
- Sản phẩm chỉ xuất hiện ở giữa video như một "lời giải" hoàn hảo và tự nhiên cho vấn đề vừa nêu.`
      : '';

    // Thay đổi linh hoạt cấu trúc JSON tùy thuộc vào việc có gắn giỏ hay không
    const jsonStructure = isShoppable
      ? `{
  "scenes": [
    { "title": "1. Mở đầu bằng Vấn đề/Nỗi đau (HOOK)", "description": "[mô tả visual]", "script": "[lời thoại đánh trúng insight]" },
    { "title": "2. Khơi gợi Đồng cảm & Hậu quả", "description": "[mô tả visual]", "script": "[lời thoại]" },
    { "title": "3. Trình bày Giải pháp (Sản phẩm)", "description": "[mô tả visual]", "script": "[lời thoại]" },
    { "title": "4. Tính ứng dụng đời sống/Test thực tế", "description": "[mô tả visual]", "script": "[lời thoại]" },
    { "title": "5. So sánh Trước & Sau", "description": "[mô tả visual]", "script": "[lời thoại]" },
    { "title": "6. Kêu gọi Hành động (Chỉ vào giỏ hàng)", "description": "[mô tả visual]", "script": "[lời thoại]" }
  ]
}`
      : `{
  "scenes": [
    { "title": "1. Mở đầu bằng Câu hỏi (HOOK)", "description": "[mô tả visual]", "script": "[lời thoại]" },
    { "title": "2. Trình bày Giải pháp", "description": "[mô tả visual]", "script": "[lời thoại]" },
    { "title": "3. Nêu bật Chức năng Cốt lõi", "description": "[mô tả visual]", "script": "[lời thoại]" },
    { "title": "4. So sánh Trước & Sau", "description": "[mô tả visual]", "script": "[lời thoại]" },
    { "title": "5. Minh họa Kết quả", "description": "[mô tả visual]", "script": "[lời thoại]" },
    { "title": "6. Kêu gọi Hành động", "description": "[mô tả visual]", "script": "[lời thoại]" }
  ]
}`;

    return `Dựa trên phân tích video sau đây:
${analysisResult}${transcriptSection}${hookSection}${shoppableSection}

Hãy tạo kịch bản video TikTok mới theo cấu trúc JSON sau:
${jsonStructure}

độ dài video 60-120 giây. Chỉ trả về JSON, không thêm giải thích.`;
  }

  private buildTitlePrompt(scriptContent: string, titleType: string): string {
    return `Dựa trên kịch bản video TikTok sau:
\`\`\`json
${scriptContent}
\`\`\`

Hãy tạo một tiêu đề video TikTok theo phong cách "${titleType}", hấp dẫn, viral cao, bằng tiếng Việt, không chứa từ cấm TikTok.
Chỉ trả về tiêu đề duy nhất, không thêm bất kỳ văn bản nào khác.`;
  }

  // Danh sách các model đã bị Google xóa hoặc không còn hỗ trợ
  private readonly DEPRECATED_MODELS = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-preview-04-17',
    'gemini-2.5-flash-preview-05-20',
    'gemini-1.5-flash-8b-exp-0827',
    'gemini-1.5-flash-8b-exp-0924',
  ];

  private sanitizeModel(modelFromDb: string | undefined): string {
    if (!modelFromDb) return FALLBACK_MODEL;

    // Strip prefix 'models/' nếu có (SDK tự thêm prefix, không cần truyền vào)
    let model = modelFromDb.replace(/^models\//, '').trim();

    // Map các tên model sai/không tồn tại về model hợp lệ
    const MODEL_REMAP: Record<string, string> = {
      'gemini-3.5-flash': 'gemini-2.5-flash',
      'gemini-3.5-flash-lite': 'gemini-2.5-flash-lite',
      'gemini-3.0-flash': 'gemini-2.5-flash',
    };
    if (MODEL_REMAP[model]) {
      this.logger.warn(`[Model] Model "${modelFromDb}" không hợp lệ, đổi sang: ${MODEL_REMAP[model]}`);
      model = MODEL_REMAP[model];
    }

    // Loại bỏ các model deprecated
    if (this.DEPRECATED_MODELS.includes(model)) {
      this.logger.warn(`[Model] Model "${model}" đã bị deprecated, dùng fallback: ${FALLBACK_MODEL}`);
      return FALLBACK_MODEL;
    }

    return model;
  }

  private async getSettingsFromDb(): Promise<{ systemPrompt: string; model: string; violationAppealPrompt: string }> {
    const admin = this.supabaseService.getAdminClient();
    const { data } = await admin.from('admin_settings').select('setting_key, setting_value').in('setting_key', ['gemini_system_prompt', 'gemini_model', 'violation_appeal_prompt']);
    const map: Record<string, string> = {};
    (data || []).forEach((r: any) => { map[r.setting_key] = r.setting_value; });
    return {
      systemPrompt: map['gemini_system_prompt'] || this.getDefaultSystemPrompt(),
      model: this.sanitizeModel(map['gemini_model']),
      violationAppealPrompt: map['violation_appeal_prompt'] || this.getDefaultViolationPrompt(),
    };
  }


  private getDefaultSystemPrompt(): string {
    return `Hãy phân tích video theo framework 5 phần: Big Idea & Emotion, Hook (3s đầu), Kịch bản, Visual & Text, Sound & Pacing. Trả lời theo JSON với keys: "bigIdea", "hook", "script", "visual", "sound".`;
  }

  private getDefaultViolationPrompt(): string {
    return `Bạn là chuyên gia chính sách TikTok 10+ năm kinh nghiệm. Hãy tư vấn kháng cáo vi phạm với tỉ lệ thành công 90%+. Trả lời 3 bước: 1. Giải thích vi phạm, 2. Nội dung kháng cáo, 3. Hướng dẫn nếu thất bại. Trả lời bằng tiếng Việt.`;
  }

  async generateBlogContent(topic: string, generateImages: boolean = true) {
    if (!topic) throw new BadRequestException('Topic is required');

    let apiKeyObj;
    try {
      apiKeyObj = await this.getActiveKeyInternal();
    } catch (e: any) {
      throw new InternalServerErrorException('Không thể lấy API key Gemini từ hệ thống quản lý.', e.message);
    }

    const { apiKey: geminiApiKey, keyId: geminiKeyId } = apiKeyObj;
    const modelName = "gemini-2.5-flash-lite";
    const prompt = `Viết một bài blog SEO chuyên nghiệp về chủ đề: "${topic}"

Yêu cầu:
1. Tiêu đề hấp dẫn và chứa từ khóa chính
2. Meta description dưới 160 ký tự
3. Nội dung từ 800-1200 từ
4. Sử dụng heading H2, H3 hợp lý
5. Tích hợp từ khóa tự nhiên
6. Câu kết luận và call-to-action
7. Đề xuất 5-7 từ khóa liên quan

Trả về JSON với format:
{
  "title": "Tiêu đề bài viết",
  "meta_description": "Mô tả meta dưới 160 ký tự",
  "content": "Nội dung bài viết đầy đủ với HTML markdown",
  "excerpt": "Tóm tắt ngắn 150-200 từ",
  "keywords": ["từ khóa 1", "từ khóa 2", "từ khóa 3", "từ khóa 4", "từ khóa 5"]
}

Nội dung phải bằng tiếng Việt, chuyên nghiệp và có giá trị thực tế.`;

    const genAI = new GoogleGenerativeAI(geminiApiKey);
    let currentModelAttempt = modelName;
    let attempts = 0;
    let generatedText = '';

    while (attempts < MAX_ATTEMPTS) {
      try {
        const model = genAI.getGenerativeModel({ model: currentModelAttempt });
        const result = await model.generateContent([prompt]);
        generatedText = result.response.text();
        break;
      } catch (error: any) {
        const errorMessage = error.message || error.toString();
        if (errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('429 Too Many Requests')) {
          await this.reportRateLimit(geminiKeyId);
          throw new InternalServerErrorException('API Key đã đạt giới hạn sử dụng. Vui lòng thử lại sau ít phút.');
        } else if (errorMessage.includes('503 Service Unavailable') && errorMessage.includes('The model is overloaded') && attempts < MAX_ATTEMPTS - 1) {
          currentModelAttempt = FALLBACK_MODEL;
          attempts++;
        } else {
          throw new InternalServerErrorException(errorMessage);
        }
      }
    }

    if (!generatedText) throw new InternalServerErrorException("Failed to generate content after multiple attempts.");

    let blogData: any;
    try {
      const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        blogData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found');
      }
    } catch {
      blogData = { title: topic, meta_description: `Tìm hiểu về ${topic}`, content: generatedText, excerpt: generatedText.substring(0, 200) + '...', keywords: [topic] };
    }

    const slug = blogData.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim();

    let uploadedImages: { cover_image_url?: string, illustration_images?: string[] } = {};

    if (generateImages) {
      const images: any[] = [];
      const titleText = (blogData.title || topic).slice(0, 80);
      const subtitleText = (blogData.meta_description || `Bài viết về ${topic}`).slice(0, 120);
      const gradientId = `g${crypto.randomUUID().slice(0, 8)}`;

      const coverSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${titleText}">
  <defs>
    <linearGradient id="${gradientId}" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#0ea5e9"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="20" flood-opacity="0.25"/>
    </filter>
  </defs>
  <rect width="1200" height="630" fill="url(#${gradientId})"/>
  <g filter="url(#shadow)">
    <rect x="60" y="60" rx="24" ry="24" width="1080" height="510" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.35)"/>
  </g>
  <g transform="translate(120, 160)">
    <text x="0" y="0" font-family="Inter, ui-sans-serif, system-ui" font-size="64" font-weight="800" fill="#ffffff">${titleText.replace(/&/g, '&amp;')}</text>
    <text x="0" y="90" font-family="Inter, ui-sans-serif, system-ui" font-size="28" font-weight="500" fill="rgba(255,255,255,0.9)">${subtitleText.replace(/&/g, '&amp;')}</text>
  </g>
  <text x="120" y="560" font-family="Inter, ui-sans-serif, system-ui" font-size="22" fill="rgba(255,255,255,0.85)">tikviral.vn • ${new Date().getFullYear()}</text>
</svg>`;
      images.push({ type: 'cover', svg: coverSvg, filename: `${slug}-cover.svg` });

      const admin = this.supabaseService.getAdminClient();
      const illustrationUrls: string[] = [];

      for (const image of images) {
        const { error } = await admin.storage.from('blog-images').upload(image.filename, Buffer.from(image.svg, 'utf-8'), { contentType: 'image/svg+xml', upsert: true });
        if (!error) {
          const { data } = admin.storage.from('blog-images').getPublicUrl(image.filename);
          if (image.type === 'cover') uploadedImages.cover_image_url = data?.publicUrl;
        }
      }
    }

    return { ...blogData, slug, ...uploadedImages };
  }
}
