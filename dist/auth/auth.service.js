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
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const crypto = __importStar(require("crypto"));
const supabase_service_1 = require("../supabase/supabase.service");
const PBKDF2_ITERATIONS = 100000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
let AuthService = class AuthService {
    supabaseService;
    configService;
    constructor(supabaseService, configService) {
        this.supabaseService = supabaseService;
        this.configService = configService;
    }
    async adminLogin(dto) {
        const supabase = this.supabaseService.getAdminClient();
        const { data, error } = await supabase
            .from('admin_users')
            .select('id, password_hash')
            .eq('username', dto.username)
            .single();
        if (error || !data) {
            throw new common_1.UnauthorizedException('Invalid credentials');
        }
        const stored = data.password_hash;
        const isValid = await this.verifyPassword(dto.password, stored);
        if (!isValid) {
            throw new common_1.UnauthorizedException('Invalid credentials');
        }
        const supabaseServiceKey = this.configService.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        const exp = Date.now() + 24 * 60 * 60 * 1000;
        const payload = `${dto.username}|${exp}`;
        const hmac = crypto.createHmac('sha256', supabaseServiceKey);
        hmac.update(payload);
        const signature = hmac.digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const tokenPayload = Buffer.from(payload).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const token = `${tokenPayload}.${signature}`;
        return {
            success: true,
            userId: data.id,
            admin_token: token,
        };
    }
    async verifyPassword(password, stored) {
        if (!stored || !password)
            return false;
        if (stored.startsWith('PBKDF2$')) {
            return this.verifyPasswordPBKDF2Format(password, stored);
        }
        if (stored.includes(':')) {
            const parts = stored.split(':');
            if (parts.length !== 2)
                return false;
            const [saltHex, hashHex] = parts;
            if (saltHex.length !== SALT_BYTES * 2 || hashHex.length !== HASH_BYTES * 2)
                return false;
            return this.verifyPasswordHex(password, saltHex, hashHex, PBKDF2_ITERATIONS);
        }
        return stored === password;
    }
    verifyPasswordPBKDF2Format(password, stored) {
        const parts = stored.split('$');
        if (parts.length !== 5)
            return false;
        const [_prefix, _algo, iterStr, saltB64, hashB64] = parts;
        const iterations = parseInt(iterStr, 10);
        if (!iterations || iterations < 1)
            return false;
        try {
            const salt = Buffer.from(saltB64, 'base64');
            const expectedHash = Buffer.from(hashB64, 'base64');
            const derivedHash = crypto.pbkdf2Sync(password, salt, iterations, expectedHash.length, 'sha256');
            return crypto.timingSafeEqual(expectedHash, derivedHash);
        }
        catch {
            return false;
        }
    }
    verifyPasswordHex(password, saltHex, hashHex, iterations) {
        try {
            const salt = Buffer.from(saltHex, 'hex');
            const expectedHash = Buffer.from(hashHex, 'hex');
            const derivedHash = crypto.pbkdf2Sync(password, salt, iterations, expectedHash.length, 'sha256');
            return crypto.timingSafeEqual(expectedHash, derivedHash);
        }
        catch {
            return false;
        }
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService,
        config_1.ConfigService])
], AuthService);
//# sourceMappingURL=auth.service.js.map