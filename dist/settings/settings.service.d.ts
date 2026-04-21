import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
export declare class SettingsService {
    private readonly supabaseService;
    private readonly configService;
    constructor(supabaseService: SupabaseService, configService: ConfigService);
    private verifyAdminToken;
    manageSettings(dto: any): Promise<{
        data: {
            setting_key: any;
            setting_value: any;
        }[];
        success?: undefined;
    } | {
        success: boolean;
        data?: undefined;
    }>;
}
