import { SettingsService } from './settings.service';
import { AdminService } from './admin.service';
export declare class SettingsController {
    private readonly settingsService;
    private readonly adminService;
    constructor(settingsService: SettingsService, adminService: AdminService);
    manageAdminSettings(body: any): Promise<{
        data: {
            setting_key: any;
            setting_value: any;
        }[];
        success?: undefined;
    } | {
        success: boolean;
        data?: undefined;
    }>;
    getUserStats(): Promise<{
        total: number;
        today: number;
        last7Days: number;
        last30Days: number;
    }>;
    getPaymentTransactions(body: any): Promise<{
        data: any[];
        count: number;
    }>;
    getAllPaymentTransactions(body: any): Promise<any[]>;
}
