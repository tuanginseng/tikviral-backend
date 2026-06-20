import { Controller, Post, Req, Res, Headers, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PaymentService } from './payment.service';

@Controller('payment')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(private readonly paymentService: PaymentService) {}

  @Post('webhook')
  async handleWebhook(
    @Req() req: Request & { rawBody?: string },
    @Res() res: Response,
    @Headers('x-webhook-signature') signature: string,
  ) {
    try {
      const result = await this.paymentService.processWebhook(req.rawBody, signature, req.body);
      return res.status(HttpStatus.OK).json(result);
    } catch (error) {
      this.logger.error(`Webhook error: ${error.message}`);
      return res.status(error.status || HttpStatus.INTERNAL_SERVER_ERROR).json({ error: error.message });
    }
  }
}
