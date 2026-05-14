import { UsageService } from './usage.service';
export declare class UsageController {
    private readonly usageService;
    constructor(usageService: UsageService);
    checkUsage(req: any): Promise<any>;
    incrementUsage(req: any): Promise<any>;
    getProfile(req: any): Promise<{
        subscription_tier: any;
        subscription_end_date: any;
        monthly_usage_count: any;
        credit_balance: any;
        monthly_credit_balance: any;
        monthly_credit_expires_at: any;
    }>;
    resetSubscription(req: any): Promise<{
        success: boolean;
    }>;
    saveVideoAnalysis(req: any, body: any): Promise<{
        id: any;
        video_title: any;
        video_url: any;
        cover_image_url: any;
    }>;
    saveGeneratedScript(req: any, body: any): Promise<{
        success: boolean;
    }>;
    saveViolationAppeal(req: any, body: any): Promise<{
        success: boolean;
    }>;
    saveScriptCheck(req: any, body: any): Promise<{
        success: boolean;
    }>;
    ensureAffiliateCode(req: any, body: {
        code: string;
    }): Promise<{
        code: any;
        created: boolean;
    }>;
}
