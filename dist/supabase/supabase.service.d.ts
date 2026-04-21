import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
export declare class SupabaseService {
    private readonly configService;
    private readonly logger;
    private supabaseAdmin;
    constructor(configService: ConfigService);
    getAdminClient(): SupabaseClient;
}
