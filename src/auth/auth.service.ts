import { Injectable, UnauthorizedException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { AdminLoginDto } from './dto/admin-login.dto';

const PBKDF2_ITERATIONS = 100000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

@Injectable()
export class AuthService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {}

  async adminLogin(dto: AdminLoginDto) {
    const supabase = this.supabaseService.getAdminClient();

    const { data, error } = await supabase
      .from('admin_users')
      .select('id, password_hash')
      .eq('username', dto.username)
      .single();

    if (error || !data) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const stored = data.password_hash;
    const isValid = await this.verifyPassword(dto.password, stored);

    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate JWT-like token exactly as edge function did
    const supabaseServiceKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY') || '';
    const exp = Date.now() + 24 * 60 * 60 * 1000; // 24h
    const payload = `${dto.username}|${exp}`;

    // HMAC SHA256 using Node crypto
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

  private async verifyPassword(password: string, stored: string): Promise<boolean> {
    if (!stored || !password) return false;

    if (stored.startsWith('PBKDF2$')) {
      return this.verifyPasswordPBKDF2Format(password, stored);
    }
    
    if (stored.includes(':')) {
      const parts = stored.split(':');
      if (parts.length !== 2) return false;
      const [saltHex, hashHex] = parts;
      if (saltHex.length !== SALT_BYTES * 2 || hashHex.length !== HASH_BYTES * 2) return false;
      return this.verifyPasswordHex(password, saltHex, hashHex, PBKDF2_ITERATIONS);
    }

    // Fallback plain-text if that was standard in original code
    return stored === password;
  }

  private verifyPasswordPBKDF2Format(password: string, stored: string): boolean {
    const parts = stored.split('$');
    if (parts.length !== 5) return false;
    const [_prefix, _algo, iterStr, saltB64, hashB64] = parts;
    const iterations = parseInt(iterStr, 10);
    if (!iterations || iterations < 1) return false;

    try {
      const salt = Buffer.from(saltB64, 'base64');
      const expectedHash = Buffer.from(hashB64, 'base64');
      
      const derivedHash = crypto.pbkdf2Sync(password, salt, iterations, expectedHash.length, 'sha256');
      
      return crypto.timingSafeEqual(expectedHash, derivedHash);
    } catch {
      return false;
    }
  }

  private verifyPasswordHex(password: string, saltHex: string, hashHex: string, iterations: number): boolean {
    try {
      const salt = Buffer.from(saltHex, 'hex');
      const expectedHash = Buffer.from(hashHex, 'hex');
      
      const derivedHash = crypto.pbkdf2Sync(password, salt, iterations, expectedHash.length, 'sha256');
      
      return crypto.timingSafeEqual(expectedHash, derivedHash);
    } catch {
      return false;
    }
  }
}
