import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { DiscountModule } from '../discount/discount.module';

@Module({
  imports: [SupabaseModule, DiscountModule],
  controllers: [PaymentController],
  providers: [PaymentService],
})
export class PaymentModule {}
