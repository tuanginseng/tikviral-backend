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
exports.GeminiController = void 0;
const common_1 = require("@nestjs/common");
const gemini_service_1 = require("./gemini.service");
let GeminiController = class GeminiController {
    geminiService;
    constructor(geminiService) {
        this.geminiService = geminiService;
    }
    async proxyRequest(body) {
        return this.geminiService.proxyRequest(body);
    }
    async manageKeys(body) {
        const { action, ...payload } = body;
        return this.geminiService.manageApiKeys(action, payload);
    }
    async generateBlogContent(body) {
        return this.geminiService.generateBlogContent(body.topic, body.generateImages);
    }
    async executeTask(body) {
        return this.geminiService.executeTask(body);
    }
};
exports.GeminiController = GeminiController;
__decorate([
    (0, common_1.Post)('proxy'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GeminiController.prototype, "proxyRequest", null);
__decorate([
    (0, common_1.Post)('manage-keys'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GeminiController.prototype, "manageKeys", null);
__decorate([
    (0, common_1.Post)('generate-blog'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GeminiController.prototype, "generateBlogContent", null);
__decorate([
    (0, common_1.Post)('task'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GeminiController.prototype, "executeTask", null);
exports.GeminiController = GeminiController = __decorate([
    (0, common_1.Controller)('gemini'),
    __metadata("design:paramtypes", [gemini_service_1.GeminiService])
], GeminiController);
//# sourceMappingURL=gemini.controller.js.map