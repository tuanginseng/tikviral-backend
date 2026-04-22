import { SupabaseService } from '../supabase/supabase.service';
export declare class GeminiService {
    private readonly supabaseService;
    private readonly logger;
    constructor(supabaseService: SupabaseService);
    proxyRequest(dto: any): Promise<{
        result: any;
        modelUsed: string | null;
    }>;
    manageApiKeys(action: string, payload: any): Promise<{
        keys: any[];
        totalCount: number;
        message?: undefined;
        key?: undefined;
        total_usage?: undefined;
        count?: undefined;
        apiKey?: undefined;
        keyId?: undefined;
    } | {
        message: string;
        key: any;
        keys?: undefined;
        totalCount?: undefined;
        total_usage?: undefined;
        count?: undefined;
        apiKey?: undefined;
        keyId?: undefined;
    } | {
        message: string;
        keys?: undefined;
        totalCount?: undefined;
        key?: undefined;
        total_usage?: undefined;
        count?: undefined;
        apiKey?: undefined;
        keyId?: undefined;
    } | {
        total_usage: any;
        keys?: undefined;
        totalCount?: undefined;
        message?: undefined;
        key?: undefined;
        count?: undefined;
        apiKey?: undefined;
        keyId?: undefined;
    } | {
        message: string;
        count: number;
        keys?: undefined;
        totalCount?: undefined;
        key?: undefined;
        total_usage?: undefined;
        apiKey?: undefined;
        keyId?: undefined;
    } | {
        apiKey: string;
        keyId: string;
        keys?: undefined;
        totalCount?: undefined;
        message?: undefined;
        key?: undefined;
        total_usage?: undefined;
        count?: undefined;
    }>;
    getActiveKeyInternal(): Promise<{
        apiKey: string;
        keyId: string;
    }>;
    reportRateLimit(keyId: string): Promise<void>;
    generateContent(parts: any[], model?: string): Promise<{
        result: string;
        modelUsed: string;
    }>;
    executeTask(dto: {
        task: string;
        videoData?: string;
        videoUrl?: string;
        mimeType?: string;
        metrics?: {
            play_count?: number;
            digg_count?: number;
            comment_count?: number;
            share_count?: number;
        };
        isViral?: 'viral' | 'not-viral' | null;
        imageData?: string;
        imageMimeType?: string;
        userMessage?: string;
        analysisResult?: string;
        transcript?: string;
        hookType?: string;
        scriptContent?: string;
        titleType?: string;
        textPromptKey?: string;
        userText?: string;
    }): Promise<{
        result: string;
    }>;
    private buildScriptPrompt;
    private buildTitlePrompt;
    private getSettingsFromDb;
    private getDefaultSystemPrompt;
    private getDefaultViolationPrompt;
    generateBlogContent(topic: string, generateImages?: boolean): Promise<any>;
}
