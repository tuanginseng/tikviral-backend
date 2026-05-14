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
exports.SettingsController = void 0;
const common_1 = require("@nestjs/common");
const settings_service_1 = require("./settings.service");
const admin_service_1 = require("./admin.service");
const supabase_auth_guard_1 = require("../auth/supabase-auth.guard");
const admin_guard_1 = require("../auth/admin.guard");
let SettingsController = class SettingsController {
    settingsService;
    adminService;
    constructor(settingsService, adminService) {
        this.settingsService = settingsService;
        this.adminService = adminService;
    }
    async manageAdminSettings(body) {
        return this.settingsService.manageSettings(body);
    }
    async getUserStats() {
        try {
            return await this.adminService.getUserStats();
        }
        catch (error) {
            throw new common_1.HttpException(error.message, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async getPaymentTransactions(body) {
        try {
            return await this.adminService.getPaymentTransactions({
                page: body.page ?? 1,
                limit: body.limit ?? 20,
                status: body.status,
                dateFrom: body.dateFrom,
                dateTo: body.dateTo,
            });
        }
        catch (error) {
            throw new common_1.HttpException(error.message, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async getAllPaymentTransactions(body) {
        try {
            return await this.adminService.getAllPaymentTransactions({
                status: body.status,
                dateFrom: body.dateFrom,
                dateTo: body.dateTo,
            });
        }
        catch (error) {
            throw new common_1.HttpException(error.message, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
};
exports.SettingsController = SettingsController;
__decorate([
    (0, common_1.Post)('manage-admin-settings'),
    (0, common_1.UseGuards)(supabase_auth_guard_1.SupabaseAuthGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "manageAdminSettings", null);
__decorate([
    (0, common_1.Post)('user-stats'),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "getUserStats", null);
__decorate([
    (0, common_1.Post)('payment-transactions'),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "getPaymentTransactions", null);
__decorate([
    (0, common_1.Post)('all-payment-transactions'),
    (0, common_1.UseGuards)(admin_guard_1.AdminGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "getAllPaymentTransactions", null);
exports.SettingsController = SettingsController = __decorate([
    (0, common_1.Controller)('settings'),
    __metadata("design:paramtypes", [settings_service_1.SettingsService,
        admin_service_1.AdminService])
], SettingsController);
//# sourceMappingURL=settings.controller.js.map