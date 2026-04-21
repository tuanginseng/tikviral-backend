import { SupabaseService } from '../supabase/supabase.service';
export declare class AffiliateService {
    private readonly supabaseService;
    constructor(supabaseService: SupabaseService);
    syncKalodataProducts(kalodataCookie: string): Promise<{
        success: boolean;
        message: string;
    }>;
    manageProducts(dto: any): Promise<{
        products: any[];
        totalCount: number;
        message?: undefined;
        product?: undefined;
    } | {
        message: string;
        product: any;
        products?: undefined;
        totalCount?: undefined;
    } | {
        message: string;
        products?: undefined;
        totalCount?: undefined;
        product?: undefined;
    }>;
    manageCommissions(dto: any): Promise<{
        bank_account_holder: any;
        bank_account_number: any;
        bank_name: any;
    } | {
        list: any[];
        total: number;
        summary?: undefined;
        success?: undefined;
        message?: undefined;
    } | {
        summary: any[];
        list?: undefined;
        total?: undefined;
        success?: undefined;
        message?: undefined;
    } | {
        success: boolean;
        message: string;
        list?: undefined;
        total?: undefined;
        summary?: undefined;
    }>;
    recordReferral(token: string, refCode: string): Promise<{
        success: boolean;
        message: string;
    }>;
    uploadAffiliateImage(imageData: string, mimeType: string, fileName: string): Promise<{
        publicUrl: string;
    }>;
}
