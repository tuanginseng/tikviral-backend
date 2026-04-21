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
exports.AdminGuard = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const crypto = __importStar(require("crypto"));
let AdminGuard = class AdminGuard {
    configService;
    constructor(configService) {
        this.configService = configService;
    }
    canActivate(context) {
        const request = context.switchToHttp().getRequest();
        const body = request.body || {};
        const adminToken = typeof body.admin_token === 'string' ? body.admin_token.trim() : null;
        if (!adminToken) {
            throw new common_1.UnauthorizedException('Unauthorized. Admin token required.');
        }
        const serviceKey = this.configService.get('SUPABASE_SERVICE_ROLE_KEY');
        if (!serviceKey) {
            throw new common_1.UnauthorizedException('Server configuration error.');
        }
        if (!this.verifyAdminToken(adminToken, serviceKey)) {
            throw new common_1.UnauthorizedException('Invalid or expired admin token.');
        }
        return true;
    }
    verifyAdminToken(token, serviceKey) {
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
};
exports.AdminGuard = AdminGuard;
exports.AdminGuard = AdminGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], AdminGuard);
//# sourceMappingURL=admin.guard.js.map