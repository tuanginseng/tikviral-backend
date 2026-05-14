import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

@Controller('settings')
@UseGuards(SupabaseAuthGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Post('manage-admin-settings')
  @HttpCode(HttpStatus.OK)
  async manageAdminSettings(@Body() body: any) {
    return this.settingsService.manageSettings(body);
  }
}
