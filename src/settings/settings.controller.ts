import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Post('manage-admin-settings')
  @HttpCode(HttpStatus.OK)
  async manageAdminSettings(@Body() body: any) {
    return this.settingsService.manageSettings(body);
  }
}
