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
exports.UsageController = void 0;
const common_1 = require("@nestjs/common");
const usage_service_1 = require("./usage.service");
const supabase_auth_guard_1 = require("../auth/supabase-auth.guard");
let UsageController = class UsageController {
    usageService;
    constructor(usageService) {
        this.usageService = usageService;
    }
    async checkUsage(req) {
        try {
            return await this.usageService.checkUsage(req.user.id);
        }
        catch (error) {
            throw new common_1.HttpException(error.message, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async incrementUsage(req) {
        try {
            return await this.usageService.incrementUsage(req.user.id);
        }
        catch (error) {
            throw new common_1.HttpException(error.message, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async getProfile(req) {
        try {
            return await this.usageService.getProfile(req.user.id);
        }
        catch (error) {
            throw new common_1.HttpException(error.message, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async resetSubscription(req) {
        try {
            return await this.usageService.resetExpiredSubscription(req.user.id);
        }
        catch (error) {
            throw new common_1.HttpException(error.message, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async saveVideoAnalysis(req, body) {
        try {
            return await this.usageService.saveVideoAnalysis(req.user.id, {
                video_url: body.video_url,
                video_title: body.video_title ?? null,
                cover_image_url: body.cover_image_url ?? null,
                analysis_result: body.analysis_result,
                viral_score: body.viral_score,
            });
        }
        catch (error) {
            throw new common_1.HttpException(error.message, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async saveGeneratedScript(req, body) {
        try {
            let videoAnalysisId = body.video_analysis_id ?? null;
            let videoTitle = body.video_title ?? null;
            let videoUrl = body.video_url ?? null;
            let coverImageUrl = body.cover_image_url ?? null;
            if (!videoAnalysisId) {
                const latest = await this.usageService.getLatestVideoAnalysis(req.user.id);
                if (latest) {
                    videoAnalysisId = latest.id;
                    videoTitle = latest.video_title;
                    videoUrl = latest.video_url;
                    coverImageUrl = latest.cover_image_url;
                }
            }
            return await this.usageService.saveGeneratedScript(req.user.id, {
                video_analysis_id: videoAnalysisId,
                video_title: videoTitle,
                video_url: videoUrl,
                cover_image_url: coverImageUrl,
                script_content: body.script_content,
            });
        }
        catch (error) {
            throw new common_1.HttpException(error.message, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async saveViolationAppeal(req, body) {
        try {
            return await this.usageService.saveViolationAppeal(req.user.id, {
                description: body.description ?? null,
                appeal_result: body.appeal_result,
            });
        }
        catch (error) {
            throw new common_1.HttpException(error.message, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async saveScriptCheck(req, body) {
        try {
            return await this.usageService.saveScriptCheck(req.user.id, {
                script_content: body.script_content,
                check_result: body.check_result,
            });
        }
        catch (error) {
            throw new common_1.HttpException(error.message, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async ensureAffiliateCode(req, body) {
        try {
            return await this.usageService.ensureAffiliateCode(req.user.id, body.code);
        }
        catch (error) {
            throw new common_1.HttpException({ message: error.message, code: error.code }, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
    }
    async createPayment(req, body) {
        try {
            return await this.usageService.createPaymentTransaction(req.user.id, {
                reference_code: body.reference_code,
                plan_tier: body.plan_tier,
                amount: body.amount,
                expires_at: body.expires_at,
            });
        }
        catch (error) {
            throw new common_1.HttpException(error.message, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async getPaymentStatus(req, body) {
        try {
            return await this.usageService.getPaymentTransactionStatus(req.user.id, body.transaction_id);
        }
        catch (error) {
            throw new common_1.HttpException(error.message, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async getHistory(req, body) {
        try {
            return await this.usageService.getHistory(req.user.id, body.table, body.page ?? 1, body.per_page ?? 10);
        }
        catch (error) {
            throw new common_1.HttpException(error.message, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async getReferralStats(req, body) {
        try {
            return await this.usageService.getReferralStats(req.user.id, body.dateFrom, body.dateTo, body.page ?? 1, body.perPage ?? 10);
        }
        catch (error) {
            throw new common_1.HttpException(error.message, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async updateBankAccount(req, body) {
        try {
            return await this.usageService.updateBankAccount(req.user.id, {
                bank_account_holder: body.bank_account_holder,
                bank_account_number: body.bank_account_number,
                bank_name: body.bank_name,
            });
        }
        catch (error) {
            throw new common_1.HttpException(error.message, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
};
exports.UsageController = UsageController;
__decorate([
    (0, common_1.Post)('check'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UsageController.prototype, "checkUsage", null);
__decorate([
    (0, common_1.Post)('increment'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UsageController.prototype, "incrementUsage", null);
__decorate([
    (0, common_1.Post)('profile'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UsageController.prototype, "getProfile", null);
__decorate([
    (0, common_1.Post)('reset-subscription'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UsageController.prototype, "resetSubscription", null);
__decorate([
    (0, common_1.Post)('save-video-analysis'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UsageController.prototype, "saveVideoAnalysis", null);
__decorate([
    (0, common_1.Post)('save-generated-script'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UsageController.prototype, "saveGeneratedScript", null);
__decorate([
    (0, common_1.Post)('save-violation-appeal'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UsageController.prototype, "saveViolationAppeal", null);
__decorate([
    (0, common_1.Post)('save-script-check'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UsageController.prototype, "saveScriptCheck", null);
__decorate([
    (0, common_1.Post)('ensure-affiliate-code'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UsageController.prototype, "ensureAffiliateCode", null);
__decorate([
    (0, common_1.Post)('create-payment'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UsageController.prototype, "createPayment", null);
__decorate([
    (0, common_1.Post)('payment-status'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UsageController.prototype, "getPaymentStatus", null);
__decorate([
    (0, common_1.Post)('get-history'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UsageController.prototype, "getHistory", null);
__decorate([
    (0, common_1.Post)('referral-stats'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UsageController.prototype, "getReferralStats", null);
__decorate([
    (0, common_1.Post)('update-bank-account'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UsageController.prototype, "updateBankAccount", null);
exports.UsageController = UsageController = __decorate([
    (0, common_1.Controller)('usage'),
    (0, common_1.UseGuards)(supabase_auth_guard_1.SupabaseAuthGuard),
    __metadata("design:paramtypes", [usage_service_1.UsageService])
], UsageController);
//# sourceMappingURL=usage.controller.js.map