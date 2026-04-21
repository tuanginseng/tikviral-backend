import { GeminiService } from './gemini.service';
export declare class GeminiController {
    private readonly geminiService;
    constructor(geminiService: GeminiService);
    proxyRequest(body: any): Promise<{
        result: any;
        modelUsed: string | null;
    }>;
    manageKeys(body: any): Promise<{
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
    generateBlogContent(body: any): Promise<any>;
    executeTask(body: any): Promise<{
        result: string;
    }>;
}
