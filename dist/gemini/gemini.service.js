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
var GeminiService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeminiService = void 0;
const common_1 = require("@nestjs/common");
const generative_ai_1 = require("@google/generative-ai");
const supabase_service_1 = require("../supabase/supabase.service");
const crypto = __importStar(require("crypto"));
const MAX_DAILY_USAGE = 250;
const FALLBACK_MODEL = "gemini-2.5-flash-lite-preview-09-2025";
const MAX_ATTEMPTS = 2;
let GeminiService = GeminiService_1 = class GeminiService {
    supabaseService;
    logger = new common_1.Logger(GeminiService_1.name);
    constructor(supabaseService) {
        this.supabaseService = supabaseService;
    }
    async proxyRequest(dto) {
        const { action, apiKeyToTest } = dto;
        let geminiApiKey = null;
        if (action === 'testApiKey' || action === 'getAvailableModels') {
            if (!apiKeyToTest)
                throw new common_1.BadRequestException('API Key is required for this action.');
            geminiApiKey = apiKeyToTest;
        }
        else {
            throw new common_1.BadRequestException(`Invalid Gemini action for proxy: ${action}.`);
        }
        let modelUsed = null;
        let responseData;
        try {
            if (action === 'testApiKey') {
                const testGenAI = new generative_ai_1.GoogleGenerativeAI(apiKeyToTest);
                const testModel = testGenAI.getGenerativeModel({ model: "gemini-pro" });
                const result = await testModel.generateContent("Hello, can you hear me?");
                responseData = result.response.text();
                modelUsed = "gemini-pro";
            }
            else if (action === 'getAvailableModels') {
                const modelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKeyToTest}`);
                if (!modelsRes.ok)
                    throw new Error(`HTTP error! status: ${modelsRes.status}`);
                const data = await modelsRes.json();
                responseData = data.models?.filter((model) => model.supportedGenerationMethods?.includes('generateContent')) || [];
            }
            return { result: responseData, modelUsed };
        }
        catch (error) {
            this.logger.error('Error in gemini proxy:', error.message);
            throw new common_1.InternalServerErrorException('Failed to process Gemini request', error.message);
        }
    }
    async manageApiKeys(action, payload) {
        const admin = this.supabaseService.getAdminClient();
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const { key_id, api_key, is_active, offset = 0, limit = 10, order } = payload;
        switch (action) {
            case 'get-all-keys': {
                let query = admin.from('gemini_api_keys').select('*', { count: 'exact' });
                if (order && Array.isArray(order)) {
                    order.forEach((opt) => { query = query.order(opt.column, { ascending: opt.ascending }); });
                }
                else {
                    query = query.order('is_active', { ascending: false }).order('created_at', { ascending: true });
                }
                const { data, count, error } = await query.range(offset, offset + limit - 1);
                if (error)
                    throw new common_1.InternalServerErrorException(error.message);
                return { keys: data || [], totalCount: count || 0 };
            }
            case 'add-key': {
                if (!api_key)
                    throw new common_1.BadRequestException('API key required');
                const { data, error } = await admin.from('gemini_api_keys').insert({ api_key: api_key.trim(), daily_usage_count: 0, last_reset_date: today }).select();
                if (error) {
                    if (error.code === '23505')
                        throw new common_1.ConflictException('API Key already exists');
                    throw new common_1.InternalServerErrorException(error.message);
                }
                return { message: 'API Key added successfully', key: data[0] };
            }
            case 'update-key': {
                if (!key_id || !api_key)
                    throw new common_1.BadRequestException('Key ID and API key required');
                const { data, error } = await admin.from('gemini_api_keys').update({ api_key: api_key.trim() }).eq('id', key_id).select();
                if (error) {
                    if (error.code === '23505')
                        throw new common_1.ConflictException('API Key already exists');
                    throw new common_1.InternalServerErrorException(error.message);
                }
                if (!data || data.length === 0)
                    throw new common_1.NotFoundException('Key not found');
                return { message: 'API Key updated successfully', key: data[0] };
            }
            case 'delete-key': {
                if (!key_id)
                    throw new common_1.BadRequestException('Key ID required');
                const { error } = await admin.from('gemini_api_keys').delete().eq('id', key_id);
                if (error)
                    throw new common_1.InternalServerErrorException(error.message);
                return { message: 'API Key deleted successfully' };
            }
            case 'toggle-key-status': {
                if (!key_id || typeof is_active !== 'boolean')
                    throw new common_1.BadRequestException('Key ID and is_active required');
                const { data, error } = await admin.from('gemini_api_keys').update({ is_active, last_used_at: now.toISOString() }).eq('id', key_id).select();
                if (error)
                    throw new common_1.InternalServerErrorException(error.message);
                if (!data || data.length === 0)
                    throw new common_1.NotFoundException('Key not found');
                return { message: 'API Key status updated', key: data[0] };
            }
            case 'get-total-usage': {
                const { data, error } = await admin.from('gemini_api_keys').select('daily_usage_count').eq('last_reset_date', today);
                if (error)
                    throw new common_1.InternalServerErrorException(error.message);
                const total = (data || []).reduce((sum, key) => sum + key.daily_usage_count, 0);
                return { total_usage: total };
            }
            case 'reset-all-keys': {
                const { data, error } = await admin.from('gemini_api_keys').update({ rate_limited_until: null, is_active: true }).neq('id', '00000000-0000-0000-0000-000000000000').select();
                if (error)
                    throw new common_1.InternalServerErrorException(error.message);
                return { message: 'All API Keys reset', count: data?.length || 0 };
            }
            case 'get-active-key-internal': {
                const { apiKey, keyId } = await this.getActiveKeyInternal();
                return { apiKey, keyId };
            }
            case 'report-rate-limit': {
                const { key_id } = payload;
                if (!key_id)
                    throw new common_1.BadRequestException('key_id required');
                await this.reportRateLimit(key_id);
                return { message: `Key ${key_id} marked as rate-limited` };
            }
            default:
                throw new common_1.BadRequestException('Invalid action');
        }
    }
    async getActiveKeyInternal() {
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
        if (error)
            throw new common_1.InternalServerErrorException(error.message);
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
                if (nextResetTimeUtc.getTime() <= nowUtc.getTime())
                    nextResetTimeUtc.setUTCDate(nextResetTimeUtc.getUTCDate() + 1);
                newRateLimitedUntil = nextResetTimeUtc.toISOString();
            }
            const { data: updatedKey, error: updateError } = await admin
                .from('gemini_api_keys')
                .update({ is_active: newIsActive, rate_limited_until: newRateLimitedUntil, last_used_at: now.toISOString(), daily_usage_count: newDailyUsageCount, last_reset_date: newLastResetDate })
                .eq('id', activeKey.id)
                .select()
                .single();
            if (updateError)
                throw new common_1.InternalServerErrorException(updateError.message);
            if (updatedKey.is_active) {
                keyToReturn = updatedKey;
            }
            else {
                throw new common_1.BadRequestException('Key hit daily limit, please retry to get another key.');
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
            if (expiredError)
                throw new common_1.InternalServerErrorException(expiredError.message);
            if (expiredKey) {
                const { data: reactivatedKey, error: reactivateError } = await admin
                    .from('gemini_api_keys')
                    .update({ is_active: true, rate_limited_until: null, last_used_at: now.toISOString(), daily_usage_count: 1, last_reset_date: today })
                    .eq('id', expiredKey.id)
                    .select()
                    .single();
                if (reactivateError)
                    throw new common_1.InternalServerErrorException(reactivateError.message);
                keyToReturn = reactivatedKey;
            }
        }
        if (keyToReturn) {
            return { apiKey: keyToReturn.api_key, keyId: keyToReturn.id };
        }
        else {
            throw new common_1.InternalServerErrorException('No available Gemini API keys');
        }
    }
    async reportRateLimit(keyId) {
        const admin = this.supabaseService.getAdminClient();
        const nowUtc = new Date();
        let nextResetTimeUtc = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate(), 2, 0, 0, 0));
        if (nextResetTimeUtc.getTime() <= nowUtc.getTime())
            nextResetTimeUtc.setUTCDate(nextResetTimeUtc.getUTCDate() + 1);
        await admin.from('gemini_api_keys').update({ is_active: false, rate_limited_until: nextResetTimeUtc.toISOString() }).eq('id', keyId);
    }
    async generateContent(parts, model) {
        if (!parts || !Array.isArray(parts) || parts.length === 0) {
            throw new common_1.BadRequestException('parts array is required');
        }
        let apiKeyObj;
        try {
            apiKeyObj = await this.getActiveKeyInternal();
        }
        catch (e) {
            throw new common_1.InternalServerErrorException('Không thể lấy API key Gemini từ hệ thống.');
        }
        const { apiKey: geminiApiKey, keyId: geminiKeyId } = apiKeyObj;
        const modelName = model || 'gemini-2.5-flash-lite-preview-09-2025';
        let currentModel = modelName;
        let attempts = 0;
        while (attempts < MAX_ATTEMPTS) {
            try {
                const genAI = new generative_ai_1.GoogleGenerativeAI(geminiApiKey);
                const geminiModel = genAI.getGenerativeModel({ model: currentModel });
                const result = await geminiModel.generateContent(parts);
                const responseText = result.response.text();
                if (!responseText || responseText.trim().length === 0) {
                    throw new common_1.InternalServerErrorException('AI trả về kết quả rỗng.');
                }
                return { result: responseText, modelUsed: currentModel };
            }
            catch (error) {
                const errorMessage = error.message || error.toString();
                if (errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('429')) {
                    await this.reportRateLimit(geminiKeyId);
                    throw new common_1.InternalServerErrorException('API Key đã đạt giới hạn sử dụng. Vui lòng thử lại sau ít phút.');
                }
                else if (errorMessage.includes('503') || errorMessage.includes('overloaded')) {
                    if (attempts < MAX_ATTEMPTS - 1) {
                        currentModel = FALLBACK_MODEL;
                        attempts++;
                    }
                    else {
                        throw new common_1.InternalServerErrorException('Model quá tải. Vui lòng thử lại sau.');
                    }
                }
                else {
                    throw new common_1.InternalServerErrorException(errorMessage);
                }
            }
        }
        throw new common_1.InternalServerErrorException('Thất bại sau nhiều lần thử.');
    }
    async executeTask(dto) {
        const settings = await this.getSettingsFromDb();
        let parts;
        switch (dto.task) {
            case 'analyze-video': {
                if (!dto.videoData && !dto.videoUrl)
                    throw new common_1.BadRequestException('videoData or videoUrl required');
                if (dto.videoData && !dto.videoUrl) {
                    if (!dto.userId) {
                        throw new common_1.BadRequestException('Chức năng tải video lên yêu cầu đăng nhập và gói 90 lượt.');
                    }
                    const admin = this.supabaseService.getAdminClient();
                    const { data: usage, error: usageError } = await admin.rpc('check_usage_only', {
                        p_user_id: dto.userId
                    });
                    if (usageError || !usage || usage.monthly_credits <= 0) {
                        throw new common_1.BadRequestException('Chức năng tải video lên chỉ dành cho người dùng đăng ký gói 90 lượt.');
                    }
                }
                let inlineData;
                if (dto.videoUrl) {
                    const response = await fetch(dto.videoUrl);
                    if (!response.ok)
                        throw new common_1.BadRequestException('Cannot fetch video from videoUrl');
                    const buffer = await response.arrayBuffer();
                    const base64 = Buffer.from(buffer).toString('base64');
                    const mimeType = response.headers.get('content-type') || 'video/mp4';
                    inlineData = { data: base64, mimeType };
                }
                else {
                    if (!dto.mimeType)
                        throw new common_1.BadRequestException('mimeType required when videoData is provided');
                    inlineData = { data: dto.videoData, mimeType: dto.mimeType };
                }
                const m = dto.metrics;
                const stats = `- Lượt xem: ${m?.play_count?.toLocaleString() || 'N/A'}\n- Lượt thích: ${m?.digg_count?.toLocaleString() || 'N/A'}\n- Bình luận: ${m?.comment_count?.toLocaleString() || 'N/A'}\n- Chia sẻ: ${m?.share_count?.toLocaleString() || 'N/A'}`;
                let prompt = stats + '\n\n' + settings.systemPrompt;
                if (m?.play_count !== undefined && m.play_count < 50000 && !dto.isViral) {
                    prompt += `\n\n**LƯU Ý:** Video chưa viral (${stats}). Hãy phân tích tại sao và đưa ra gợi ý cải thiện.`;
                }
                else if (dto.isViral === 'not-viral') {
                    prompt += `\n\n**LƯU Ý:** Video được chỉ định là CHƯA VIRAL. Hãy phân tích tại sao và gợi ý cải thiện.`;
                }
                else if (dto.isViral === 'viral') {
                    prompt += `\n\n**LƯU Ý:** Video được chỉ định là ĐÃ VIRAL. Phân tích yếu tố giúp viral.`;
                }
                parts = [{ inlineData }, { text: prompt }];
                break;
            }
            case 'analyze-violation': {
                if (!dto.imageData || !dto.imageMimeType)
                    throw new common_1.BadRequestException('imageData and imageMimeType required');
                parts = [
                    { inlineData: { data: dto.imageData, mimeType: dto.imageMimeType } },
                    { text: settings.violationAppealPrompt },
                    { text: dto.userMessage || '' },
                ];
                break;
            }
            case 'extract-script': {
                if (!dto.videoData && !dto.videoUrl)
                    throw new common_1.BadRequestException('videoData or videoUrl required');
                let inlineData;
                if (dto.videoUrl) {
                    const response = await fetch(dto.videoUrl);
                    if (!response.ok)
                        throw new common_1.BadRequestException('Cannot fetch video from videoUrl');
                    const buffer = await response.arrayBuffer();
                    const base64 = Buffer.from(buffer).toString('base64');
                    const mimeType = response.headers.get('content-type') || 'video/mp4';
                    inlineData = { data: base64, mimeType };
                }
                else {
                    if (!dto.mimeType)
                        throw new common_1.BadRequestException('mimeType required when videoData is provided');
                    inlineData = { data: dto.videoData, mimeType: dto.mimeType };
                }
                const extractPrompt = `Trích xuất tất cả lời thoại, văn bản, và nội dung âm thanh từ video này. Bao gồm:\n\n**LỜI THOẠI/VOICE-OVER:**\n[Tất cả lời nói]\n\n**TEXT TRÊN MÀN HÌNH:**\n[Văn bản xuất hiện]\n\n**NỘI DUNG CHÍNH:**\n[Mô tả chi tiết]\n\n**ÂM THANH/NHẠC:**\n[Mô tả âm thanh]`;
                parts = [{ inlineData }, { text: extractPrompt }];
                break;
            }
            case 'create-script': {
                if (!dto.analysisResult)
                    throw new common_1.BadRequestException('analysisResult required');
                const scriptPrompt = this.buildScriptPrompt(dto.analysisResult, dto.transcript || null, dto.hookType || null);
                parts = [{ text: scriptPrompt }];
                break;
            }
            case 'generate-title': {
                if (!dto.scriptContent || !dto.titleType)
                    throw new common_1.BadRequestException('scriptContent and titleType required');
                const titlePrompt = this.buildTitlePrompt(dto.scriptContent, dto.titleType);
                parts = [{ text: titlePrompt }];
                break;
            }
            case 'generate-text': {
                if (!dto.userText)
                    throw new common_1.BadRequestException('userText required');
                const sysPrompt = dto.textPromptKey ? settings[dto.textPromptKey] || '' : '';
                parts = sysPrompt ? [{ text: sysPrompt }, { text: dto.userText }] : [{ text: dto.userText }];
                break;
            }
            default:
                throw new common_1.BadRequestException(`Unknown task: ${dto.task}`);
        }
        const { result } = await this.generateContent(parts, settings.model);
        return { result };
    }
    buildScriptPrompt(analysisResult, transcript, hookType) {
        const transcriptSection = transcript
            ? `\n\n**TRANSCRIPT GỐC:**\n${transcript}`
            : '';
        const hookSection = hookType
            ? `\n\n**YÊU CẦU HOOK:** Sử dụng kiểu hook "${hookType}" cho scene đầu tiên.`
            : '';
        return `Dựa trên phân tích video sau đây:
${analysisResult}${transcriptSection}${hookSection}

Hãy tạo kịch bản video TikTok mới theo cấu trúc JSON sau:
{
  "scenes": [
    { "title": "1. Mở đầu bằng Câu hỏi (HOOK)", "description": "[mô tả visual]", "script": "[lời thoại]" },
    { "title": "2. Trình bày Giải pháp", "description": "[mô tả visual]", "script": "[lời thoại]" },
    { "title": "3. Nêu bật Chức năng Cốt lõi", "description": "[mô tả visual]", "script": "[lời thoại]" },
    { "title": "4. So sánh Trước & Sau", "description": "[mô tả visual]", "script": "[lời thoại]" },
    { "title": "5. Minh họa Kết quả", "description": "[mô tả visual]", "script": "[lời thoại]" },
    { "title": "6. Kêu gọi Hành động", "description": "[mô tả visual]", "script": "[lời thoại]" }
  ]
}

Chỉ trả về JSON, không thêm giải thích.`;
    }
    buildTitlePrompt(scriptContent, titleType) {
        return `Dựa trên kịch bản video TikTok sau:
\`\`\`json
${scriptContent}
\`\`\`

Hãy tạo một tiêu đề video TikTok theo phong cách "${titleType}", hấp dẫn, viral cao, bằng tiếng Việt, không chứa từ cấm TikTok.
Chỉ trả về tiêu đề duy nhất, không thêm bất kỳ văn bản nào khác.`;
    }
    async getSettingsFromDb() {
        const admin = this.supabaseService.getAdminClient();
        const { data } = await admin.from('admin_settings').select('setting_key, setting_value').in('setting_key', ['gemini_system_prompt', 'gemini_model', 'violation_appeal_prompt']);
        const map = {};
        (data || []).forEach((r) => { map[r.setting_key] = r.setting_value; });
        return {
            systemPrompt: map['gemini_system_prompt'] || this.getDefaultSystemPrompt(),
            model: map['gemini_model'] || FALLBACK_MODEL,
            violationAppealPrompt: map['violation_appeal_prompt'] || this.getDefaultViolationPrompt(),
        };
    }
    getDefaultSystemPrompt() {
        return `Hãy phân tích video theo framework 5 phần: Big Idea & Emotion, Hook (3s đầu), Kịch bản, Visual & Text, Sound & Pacing. Trả lời theo JSON với keys: "bigIdea", "hook", "script", "visual", "sound".`;
    }
    getDefaultViolationPrompt() {
        return `Bạn là chuyên gia chính sách TikTok 10+ năm kinh nghiệm. Hãy tư vấn kháng cáo vi phạm với tỉ lệ thành công 90%+. Trả lời 3 bước: 1. Giải thích vi phạm, 2. Nội dung kháng cáo, 3. Hướng dẫn nếu thất bại. Trả lời bằng tiếng Việt.`;
    }
    async generateBlogContent(topic, generateImages = true) {
        if (!topic)
            throw new common_1.BadRequestException('Topic is required');
        let apiKeyObj;
        try {
            apiKeyObj = await this.getActiveKeyInternal();
        }
        catch (e) {
            throw new common_1.InternalServerErrorException('Không thể lấy API key Gemini từ hệ thống quản lý.', e.message);
        }
        const { apiKey: geminiApiKey, keyId: geminiKeyId } = apiKeyObj;
        const modelName = "gemini-2.5-flash-lite-preview-09-2025";
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
        const genAI = new generative_ai_1.GoogleGenerativeAI(geminiApiKey);
        let currentModelAttempt = modelName;
        let attempts = 0;
        let generatedText = '';
        while (attempts < MAX_ATTEMPTS) {
            try {
                const model = genAI.getGenerativeModel({ model: currentModelAttempt });
                const result = await model.generateContent([prompt]);
                generatedText = result.response.text();
                break;
            }
            catch (error) {
                const errorMessage = error.message || error.toString();
                if (errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('429 Too Many Requests')) {
                    await this.reportRateLimit(geminiKeyId);
                    throw new common_1.InternalServerErrorException('API Key đã đạt giới hạn sử dụng. Vui lòng thử lại sau ít phút.');
                }
                else if (errorMessage.includes('503 Service Unavailable') && errorMessage.includes('The model is overloaded') && attempts < MAX_ATTEMPTS - 1) {
                    currentModelAttempt = FALLBACK_MODEL;
                    attempts++;
                }
                else {
                    throw new common_1.InternalServerErrorException(errorMessage);
                }
            }
        }
        if (!generatedText)
            throw new common_1.InternalServerErrorException("Failed to generate content after multiple attempts.");
        let blogData;
        try {
            const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                blogData = JSON.parse(jsonMatch[0]);
            }
            else {
                throw new Error('No JSON found');
            }
        }
        catch {
            blogData = { title: topic, meta_description: `Tìm hiểu về ${topic}`, content: generatedText, excerpt: generatedText.substring(0, 200) + '...', keywords: [topic] };
        }
        const slug = blogData.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim();
        let uploadedImages = {};
        if (generateImages) {
            const images = [];
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
            const illustrationUrls = [];
            for (const image of images) {
                const { error } = await admin.storage.from('blog-images').upload(image.filename, Buffer.from(image.svg, 'utf-8'), { contentType: 'image/svg+xml', upsert: true });
                if (!error) {
                    const { data } = admin.storage.from('blog-images').getPublicUrl(image.filename);
                    if (image.type === 'cover')
                        uploadedImages.cover_image_url = data?.publicUrl;
                }
            }
        }
        return { ...blogData, slug, ...uploadedImages };
    }
};
exports.GeminiService = GeminiService;
exports.GeminiService = GeminiService = GeminiService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService])
], GeminiService);
//# sourceMappingURL=gemini.service.js.map