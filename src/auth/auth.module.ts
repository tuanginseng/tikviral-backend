import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import { AdminGuard } from './admin.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SupabaseAuthGuard, AdminGuard],
  exports: [AuthService, SupabaseAuthGuard, AdminGuard],
})
export class AuthModule {}
