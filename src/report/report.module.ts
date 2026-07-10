import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { ReportService } from './report.service';

@Module({
  imports: [SupabaseModule],
  providers: [ReportService],
})
export class ReportModule {}
