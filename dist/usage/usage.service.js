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
var UsageService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsageService = void 0;
const common_1 = require("@nestjs/common");
const supabase_service_1 = require("../supabase/supabase.service");
let UsageService = UsageService_1 = class UsageService {
    supabaseService;
    logger = new common_1.Logger(UsageService_1.name);
    constructor(supabaseService) {
        this.supabaseService = supabaseService;
    }
    async checkUsage(userId) {
        const supabase = this.supabaseService.getAdminClient();
        const { data, error } = await supabase.rpc('check_usage_only', {
            p_user_id: userId,
        });
        if (error) {
            this.logger.error(`check_usage_only error for user ${userId}: ${error.message}`);
            throw new Error(error.message);
        }
        return data;
    }
    async incrementUsage(userId) {
        const supabase = this.supabaseService.getAdminClient();
        const { data, error } = await supabase.rpc('increment_usage_after_success', {
            p_user_id: userId,
        });
        if (error) {
            this.logger.error(`increment_usage_after_success error for user ${userId}: ${error.message}`);
            throw new Error(error.message);
        }
        return data;
    }
    async getProfile(userId) {
        const supabase = this.supabaseService.getAdminClient();
        const { data, error } = await supabase
            .from('profiles')
            .select('subscription_tier, subscription_end_date, monthly_usage_count, credit_balance, monthly_credit_balance, monthly_credit_expires_at')
            .eq('id', userId)
            .single();
        if (error) {
            this.logger.error(`getProfile error for user ${userId}: ${error.message}`);
            throw new Error(error.message);
        }
        return data;
    }
    async resetExpiredSubscription(userId) {
        const supabase = this.supabaseService.getAdminClient();
        const { error } = await supabase
            .from('profiles')
            .update({ subscription_tier: 'free', subscription_end_date: null })
            .eq('id', userId);
        if (error) {
            this.logger.error(`resetExpiredSubscription error for user ${userId}: ${error.message}`);
            throw new Error(error.message);
        }
        return { success: true };
    }
    async saveVideoAnalysis(userId, payload) {
        const supabase = this.supabaseService.getAdminClient();
        const { data, error } = await supabase
            .from('video_analyses')
            .insert({ ...payload, user_id: userId })
            .select('id, video_title, video_url, cover_image_url')
            .single();
        if (error) {
            this.logger.error(`saveVideoAnalysis error for user ${userId}: ${error.message}`);
            throw new Error(error.message);
        }
        return data;
    }
    async saveGeneratedScript(userId, payload) {
        const supabase = this.supabaseService.getAdminClient();
        const { error } = await supabase
            .from('generated_scripts')
            .insert({ ...payload, user_id: userId });
        if (error) {
            this.logger.error(`saveGeneratedScript error for user ${userId}: ${error.message}`);
            throw new Error(error.message);
        }
        return { success: true };
    }
    async getLatestVideoAnalysis(userId) {
        const supabase = this.supabaseService.getAdminClient();
        const { data } = await supabase
            .from('video_analyses')
            .select('id, video_title, video_url, cover_image_url')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
        return data;
    }
    async saveViolationAppeal(userId, payload) {
        const supabase = this.supabaseService.getAdminClient();
        const { error } = await supabase
            .from('violation_appeals')
            .insert({ ...payload, user_id: userId });
        if (error) {
            this.logger.error(`saveViolationAppeal error for user ${userId}: ${error.message}`);
            throw new Error(error.message);
        }
        return { success: true };
    }
    async saveScriptCheck(userId, payload) {
        const supabase = this.supabaseService.getAdminClient();
        const { error } = await supabase
            .from('script_checks')
            .insert({ ...payload, user_id: userId });
        if (error) {
            this.logger.error(`saveScriptCheck error for user ${userId}: ${error.message}`);
            throw new Error(error.message);
        }
        return { success: true };
    }
    async ensureAffiliateCode(userId, code) {
        const supabase = this.supabaseService.getAdminClient();
        const { data: existing } = await supabase
            .from('affiliate_codes')
            .select('code')
            .eq('user_id', userId)
            .maybeSingle();
        if (existing) {
            return { code: existing.code, created: false };
        }
        const { error } = await supabase.from('affiliate_codes').insert({
            user_id: userId,
            code,
        });
        if (error) {
            this.logger.error(`ensureAffiliateCode error for user ${userId}: ${error.message}`);
            throw error;
        }
        return { code, created: true };
    }
};
exports.UsageService = UsageService;
exports.UsageService = UsageService = UsageService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService])
], UsageService);
//# sourceMappingURL=usage.service.js.map