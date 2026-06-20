import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import * as crypto from 'crypto';

export interface BankWebhookPayload {
  gateway: string;
  transactionDate: string;
  accountNumber: string;
  subAccount?: string;
  code: string;
  content: string;
  transferType: string;
  description: string;
  transferAmount: number;
  referenceCode: string;
  accumulated: number;
  id: string;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
  ) {}

  async processWebhook(rawBody: string | undefined, signature: string | undefined, payload: BankWebhookPayload) {
    const webhookSecret = this.configService.get<string>('WEBHOOK_SECRET');

    if (webhookSecret) {
      if (!signature) {
        throw new HttpException('Missing signature', HttpStatus.UNAUTHORIZED);
      }

      if (!rawBody) {
        throw new HttpException('Missing raw body', HttpStatus.BAD_REQUEST);
      }

      const hmac = crypto.createHmac('sha256', webhookSecret);
      hmac.update(rawBody);
      const expectedSig = hmac.digest('hex');

      if (expectedSig !== signature) {
        this.logger.error(`Invalid webhook signature. Expected: ${expectedSig}, Got: ${signature}`);
        throw new HttpException('Invalid signature', HttpStatus.UNAUTHORIZED);
      }
    }

    this.logger.log('Received webhook payload: ' + JSON.stringify(payload));

    const referenceMatch = payload.content.match(/VT\d{3,10}/) || payload.code.match(/VT\d{3,10}/);
    
    if (!referenceMatch) {
      this.logger.error('No valid reference code found in webhook');
      throw new HttpException('Invalid reference code format', HttpStatus.BAD_REQUEST);
    }

    const referenceCode = referenceMatch[0];
    this.logger.log(`Extracted reference code: ${referenceCode}`);

    const supabase = this.supabaseService.getAdminClient();

    const { data: transaction, error: fetchError } = await supabase
      .from('payment_transactions')
      .select('*')
      .eq('reference_code', referenceCode)
      .eq('status', 'pending')
      .maybeSingle();

    if (fetchError) {
      this.logger.error('Error fetching transaction', fetchError);
      throw new HttpException('Database error', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    if (!transaction) {
      this.logger.log(`No pending transaction found for reference code: ${referenceCode}`);
      throw new HttpException('Transaction not found or already processed', HttpStatus.NOT_FOUND);
    }

    if (new Date(transaction.expires_at) < new Date()) {
      this.logger.log('Transaction has expired');
      throw new HttpException('Transaction expired', HttpStatus.BAD_REQUEST);
    }

    if (payload.transferAmount !== transaction.amount) {
      this.logger.error(`Amount mismatch: expected ${transaction.amount}, got ${payload.transferAmount}`);
      throw new HttpException('Amount mismatch', HttpStatus.BAD_REQUEST);
    }

    const { data: currentProfile } = await supabase
      .from('profiles')
      .select('credit_balance, monthly_credit_balance')
      .eq('id', transaction.user_id)
      .single();

    let creditsToAdd = 0;
    let updateData: any = {};
    
    switch (transaction.plan_tier) {
      case 'per_use_1':
        creditsToAdd = 1;
        updateData = {
          credit_balance: (currentProfile?.credit_balance || 0) + 1
        };
        break;
      case 'per_use_10':
        creditsToAdd = 10;
        updateData = {
          credit_balance: (currentProfile?.credit_balance || 0) + 10
        };
        break;
      case 'monthly_90':
        creditsToAdd = 90;
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 30);
        updateData = {
          monthly_credit_balance: (currentProfile?.monthly_credit_balance || 0) + 90,
          monthly_credit_expires_at: expiryDate.toISOString(),
          subscription_tier: 'pro',
          subscription_end_date: expiryDate.toISOString()
        };
        break;
      default:
        this.logger.error(`Invalid plan tier: ${transaction.plan_tier}`);
        throw new HttpException('Invalid plan tier', HttpStatus.BAD_REQUEST);
    }

    const { error: updateTxnError } = await supabase
      .from('payment_transactions')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        bank_transaction_data: payload
      })
      .eq('id', transaction.id);

    if (updateTxnError) {
      this.logger.error('Error updating transaction', updateTxnError);
      throw new HttpException('Failed to update transaction', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const { error: updateProfileError } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('id', transaction.user_id);

    if (updateProfileError) {
      this.logger.error('Error updating profile', updateProfileError);
      throw new HttpException('Failed to update credits', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const { data: referral } = await supabase
      .from('referrals')
      .select('id, referrer_id, first_payment_at, commission_window_end')
      .eq('referred_user_id', transaction.user_id)
      .maybeSingle();

    if (referral) {
      const now = new Date();
      let firstPaymentAt = referral.first_payment_at ? new Date(referral.first_payment_at) : null;
      let commissionWindowEnd = referral.commission_window_end ? new Date(referral.commission_window_end) : null;

      if (!firstPaymentAt) {
        firstPaymentAt = now;
        commissionWindowEnd = new Date(now);
        commissionWindowEnd.setFullYear(commissionWindowEnd.getFullYear() + 1);
        await supabase
          .from('referrals')
          .update({
            first_payment_at: firstPaymentAt.toISOString(),
            commission_window_end: commissionWindowEnd.toISOString(),
            updated_at: now.toISOString(),
          })
          .eq('id', referral.id);
      }

      if (commissionWindowEnd && now <= commissionWindowEnd) {
        const { data: existingCommission } = await supabase
          .from('affiliate_commissions')
          .select('id')
          .eq('transaction_id', transaction.id)
          .maybeSingle();

        if (!existingCommission) {
          const amount = Number(transaction.amount);
          const commissionAmount = Math.round(amount * 0.3);
          await supabase.from('affiliate_commissions').insert({
            referrer_id: referral.referrer_id,
            referral_id: referral.id,
            transaction_id: transaction.id,
            amount,
            commission_rate: 0.3,
            commission_amount: commissionAmount,
            status: 'pending',
          });
        }
      }
    }

    this.logger.log(`Successfully processed payment for user: ${transaction.user_id}`);

    return { 
      success: true, 
      message: 'Payment processed successfully',
      plan_tier: transaction.plan_tier,
      credits_added: creditsToAdd
    };
  }
}
