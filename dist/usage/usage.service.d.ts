import { SupabaseService } from '../supabase/supabase.service';
export declare class UsageService {
    private readonly supabaseService;
    private readonly logger;
    constructor(supabaseService: SupabaseService);
    checkUsage(userId: string): Promise<any>;
    incrementUsage(userId: string): Promise<any>;
    getProfile(userId: string): Promise<{
        subscription_tier: any;
        subscription_end_date: any;
        monthly_usage_count: any;
        credit_balance: any;
        monthly_credit_balance: any;
        monthly_credit_expires_at: any;
    }>;
    resetExpiredSubscription(userId: string): Promise<{
        success: boolean;
    }>;
    saveVideoAnalysis(userId: string, payload: {
        video_url: string;
        video_title: string | null;
        cover_image_url: string | null;
        analysis_result: any;
        viral_score: number;
    }): Promise<{
        id: any;
        video_title: any;
        video_url: any;
        cover_image_url: any;
    }>;
    saveGeneratedScript(userId: string, payload: {
        video_analysis_id: string | null;
        video_title: string | null;
        video_url: string | null;
        cover_image_url: string | null;
        script_content: string;
    }): Promise<{
        success: boolean;
    }>;
    getLatestVideoAnalysis(userId: string): Promise<{
        id: any;
        video_title: any;
        video_url: any;
        cover_image_url: any;
    } | null>;
    saveViolationAppeal(userId: string, payload: {
        description: string | null;
        appeal_result: string;
    }): Promise<{
        success: boolean;
    }>;
    saveScriptCheck(userId: string, payload: {
        script_content: string;
        check_result: string;
    }): Promise<{
        success: boolean;
    }>;
    ensureAffiliateCode(userId: string, code: string): Promise<{
        code: any;
        created: boolean;
    }>;
    createPaymentTransaction(userId: string, payload: {
        reference_code: string;
        plan_tier: string;
        amount: number;
        expires_at: string;
    }): Promise<{
        id: any;
    }>;
    getPaymentTransactionStatus(userId: string, transactionId: string): Promise<{
        status: any;
    }>;
    getHistory(userId: string, table: string, page: number, perPage: number): Promise<{
        data: any[];
        count: number;
    }>;
    getReferralStats(userId: string, dateFrom: string, dateTo: string, page: number, perPage: number): Promise<{
        code: any;
        referralsCount: number;
        paidReferralsCount: number;
        commissions: {
            id: any;
            amount: any;
            commission_amount: any;
            status: any;
            created_at: any;
        }[];
        commissionsTotal: number;
        profile: {
            bank_account_holder: any;
            bank_account_number: any;
            bank_name: any;
        };
    }>;
    updateBankAccount(userId: string, payload: {
        bank_account_holder: string | null;
        bank_account_number: string | null;
        bank_name: string | null;
    }): Promise<{
        success: boolean;
    }>;
}
