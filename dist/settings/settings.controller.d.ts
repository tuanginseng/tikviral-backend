import { SettingsService } from './settings.service';
export declare class SettingsController {
    private readonly settingsService;
    constructor(settingsService: SettingsService);
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
}
