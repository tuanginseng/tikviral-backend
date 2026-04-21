import { Injectable, BadRequestException, ForbiddenException, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import * as crypto from 'crypto';

@Injectable()
export class SettingsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {}

  private verifyAdminToken(token: string): boolean {
    const serviceKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!token || !serviceKey) return false;

    try {
      const parts = token.split('.');
      if (parts.length !== 2) return false;
      const payloadB64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
      const payload = Buffer.from(payloadB64, 'base64').toString('utf8');
      const partsPayload = payload.split('|');
      if (partsPayload.length !== 2) return false;
      const expStr = partsPayload[1];
      const exp = Number(expStr);
      if (!exp || Date.now() > exp) return false;

      const hmac = crypto.createHmac('sha256', serviceKey);
      hmac.update(payload);
      const expectedSig = hmac.digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return expectedSig === parts[1];
    } catch {
      return false;
    }
  }

  async manageSettings(dto: any) {
    const admin = this.supabaseService.getAdminClient();
    const { action, keys, settings, admin_token } = dto;

    if (action === 'read') {
      if (!keys || !Array.isArray(keys) || keys.length === 0) {
        throw new BadRequestException('keys array required');
      }

      const sensitiveKeys = ['gemini_api_key', 'kalodata_cookie'];
      const hasSensitive = keys.some((k: string) => sensitiveKeys.includes(k));

      if (hasSensitive && !this.verifyAdminToken(admin_token)) {
        throw new ForbiddenException('Admin authentication required for sensitive settings');
      }

      const { data, error } = await admin.from('admin_settings').select('setting_key, setting_value').in('setting_key', keys);
      if (error) throw new InternalServerErrorException(error.message);
      return { data };
    }

    if (action === 'write') {
      if (!this.verifyAdminToken(admin_token)) {
        throw new UnauthorizedException('Invalid or expired admin token');
      }
      if (!settings || !Array.isArray(settings)) {
        throw new BadRequestException('settings array required');
      }

      for (const setting of settings) {
        const { error } = await admin.from('admin_settings').upsert(setting, { onConflict: 'setting_key', ignoreDuplicates: false });
        if (error) throw new InternalServerErrorException(error.message);
      }

      return { success: true };
    }

    throw new BadRequestException('Invalid action');
  }
}
