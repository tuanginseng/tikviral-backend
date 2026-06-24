import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { AdminService } from './admin.service';
import { AuthModule } from '../auth/auth.module';
import { GeminiModule } from '../gemini/gemini.module';

@Module({
  imports: [AuthModule, GeminiModule],
  controllers: [SettingsController],
  providers: [SettingsService, AdminService],
})
export class SettingsModule {}
