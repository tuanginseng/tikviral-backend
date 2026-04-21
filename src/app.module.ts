import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SupabaseModule } from './supabase/supabase.module';
import { AuthModule } from './auth/auth.module';
import { AffiliateModule } from './affiliate/affiliate.module';
import { GeminiModule } from './gemini/gemini.module';
import { SettingsModule } from './settings/settings.module';
import { VideoModule } from './video/video.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // makes ConfigService available throughout the app
    }),
    SupabaseModule,
    AuthModule,
    AffiliateModule,
    GeminiModule,
    SettingsModule,
    VideoModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
