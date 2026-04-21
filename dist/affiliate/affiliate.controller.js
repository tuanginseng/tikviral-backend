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
exports.AffiliateController = void 0;
const common_1 = require("@nestjs/common");
const affiliate_service_1 = require("./affiliate.service");
const admin_guard_1 = require("../auth/admin.guard");
let AffiliateController = class AffiliateController {
    affiliateService;
    constructor(affiliateService) {
        this.affiliateService = affiliateService;
    }
    async syncKalodataProducts(body) {
        return this.affiliateService.syncKalodataProducts(body.kalodataCookie);
    }
    async manageAffiliateProducts(body) {
        return this.affiliateService.manageProducts(body);
    }
    async adminAffiliateCommissions(body) {
        return this.affiliateService.manageCommissions(body);
    }
    async recordReferral(req, body) {
        const authHeader = req.headers['authorization'];
        const token = authHeader?.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : '';
        return this.affiliateService.recordReferral(token, body.ref_code);
    }
    async uploadAffiliateImage(body) {
        return this.affiliateService.uploadAffiliateImage(body.imageData, body.mimeType, body.fileName);
    }
};
exports.AffiliateController = AffiliateController;
__decorate([
    (0, common_1.Post)('sync-kalodata-products'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AffiliateController.prototype, "syncKalodataProducts", null);
__decorate([
    (0, common_1.Post)('manage-affiliate-products'),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AffiliateController.prototype, "manageAffiliateProducts", null);
__decorate([
    (0, common_1.Post)('admin-affiliate-commissions'),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AffiliateController.prototype, "adminAffiliateCommissions", null);
__decorate([
    (0, common_1.Post)('record-referral'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AffiliateController.prototype, "recordReferral", null);
__decorate([
    (0, common_1.Post)('upload-affiliate-image'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AffiliateController.prototype, "uploadAffiliateImage", null);
exports.AffiliateController = AffiliateController = __decorate([
    (0, common_1.Controller)('affiliate'),
    __metadata("design:paramtypes", [affiliate_service_1.AffiliateService])
], AffiliateController);
//# sourceMappingURL=affiliate.controller.js.map