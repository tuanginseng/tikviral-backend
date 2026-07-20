import { Module } from '@nestjs/common';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';
import { UsageModule } from '../usage/usage.module';
import { GeminiModule } from '../gemini/gemini.module';

@Module({
  imports: [UsageModule, GeminiModule],
  controllers: [VideoController],
  providers: [VideoService],
  exports: [VideoService],
})
export class VideoModule {}
