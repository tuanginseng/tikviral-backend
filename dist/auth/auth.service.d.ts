import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { AdminLoginDto } from './dto/admin-login.dto';
export declare class AuthService {
    private readonly supabaseService;
    private readonly configService;
    constructor(supabaseService: SupabaseService, configService: ConfigService);
    adminLogin(dto: AdminLoginDto): Promise<{
        success: boolean;
        userId: any;
        admin_token: string;
    }>;
    private verifyPassword;
    private verifyPasswordPBKDF2Format;
    private verifyPasswordHex;
}
