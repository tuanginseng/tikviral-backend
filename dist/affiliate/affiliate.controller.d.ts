import { AffiliateService } from './affiliate.service';
export declare class AffiliateController {
    private readonly affiliateService;
    constructor(affiliateService: AffiliateService);
    syncKalodataProducts(body: any): Promise<{
        success: boolean;
        message: string;
    }>;
    manageAffiliateProducts(body: any): Promise<{
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
    adminAffiliateCommissions(body: any): Promise<{
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
    recordReferral(req: any, body: any): Promise<{
        success: boolean;
        message: string;
    }>;
    uploadAffiliateImage(body: any): Promise<{
        publicUrl: string;
    }>;
}
