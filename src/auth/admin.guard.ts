import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const body = request.body || {};
    // Extract token from body like the current Deno functions do
    const adminToken = typeof body.admin_token === 'string' ? body.admin_token.trim() : null;

    if (!adminToken) {
      throw new UnauthorizedException('Unauthorized. Admin token required.');
    }

    const serviceKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    if (!serviceKey) {
      throw new UnauthorizedException('Server configuration error.');
    }

    if (!this.verifyAdminToken(adminToken, serviceKey)) {
      throw new UnauthorizedException('Invalid or expired admin token.');
    }

    return true;
  }

  private verifyAdminToken(token: string, serviceKey: string): boolean {
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
}
