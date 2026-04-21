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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const supabase_service_1 = require("../supabase/supabase.service");
const crypto = __importStar(require("crypto"));
let SettingsService = class SettingsService {
    supabaseService;
    configService;
    constructor(supabaseService, configService) {
        this.supabaseService = supabaseService;
        this.configService = configService;
    }
    verifyAdminToken(token) {
        const serviceKey = this.configService.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        if (!token || !serviceKey)
            return false;
        try {
            const parts = token.split('.');
            if (parts.length !== 2)
                return false;
            const payloadB64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
            const payload = Buffer.from(payloadB64, 'base64').toString('utf8');
            const partsPayload = payload.split('|');
            if (partsPayload.length !== 2)
                return false;
            const expStr = partsPayload[1];
            const exp = Number(expStr);
            if (!exp || Date.now() > exp)
                return false;
            const hmac = crypto.createHmac('sha256', serviceKey);
            hmac.update(payload);
            const expectedSig = hmac.digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            return expectedSig === parts[1];
        }
        catch {
            return false;
        }
    }
    async manageSettings(dto) {
        const admin = this.supabaseService.getAdminClient();
        const { action, keys, settings, admin_token } = dto;
        if (action === 'read') {
            if (!keys || !Array.isArray(keys) || keys.length === 0) {
                throw new common_1.BadRequestException('keys array required');
            }
            const sensitiveKeys = ['gemini_api_key', 'kalodata_cookie'];
            const hasSensitive = keys.some((k) => sensitiveKeys.includes(k));
            if (hasSensitive && !this.verifyAdminToken(admin_token)) {
                throw new common_1.ForbiddenException('Admin authentication required for sensitive settings');
            }
            const { data, error } = await admin.from('admin_settings').select('setting_key, setting_value').in('setting_key', keys);
            if (error)
                throw new common_1.InternalServerErrorException(error.message);
            return { data };
        }
        if (action === 'write') {
            if (!this.verifyAdminToken(admin_token)) {
                throw new common_1.UnauthorizedException('Invalid or expired admin token');
            }
            if (!settings || !Array.isArray(settings)) {
                throw new common_1.BadRequestException('settings array required');
            }
            for (const setting of settings) {
                const { error } = await admin.from('admin_settings').upsert(setting, { onConflict: 'setting_key', ignoreDuplicates: false });
                if (error)
                    throw new common_1.InternalServerErrorException(error.message);
            }
            return { success: true };
        }
        throw new common_1.BadRequestException('Invalid action');
    }
};
exports.SettingsService = SettingsService;
exports.SettingsService = SettingsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService,
        config_1.ConfigService])
], SettingsService);
//# sourceMappingURL=settings.service.js.map