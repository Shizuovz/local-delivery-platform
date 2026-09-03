import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import { mockPaymentConfirmSchema, mockPaymentWebhookSchema } from '@local-delivery/validation';
import { User } from '@local-delivery/types';
import { CurrentUser } from '../../common/current-user.decorator';
import { Public } from '../../common/public.decorator';
import { RateLimit } from '../../common/rate-limit.decorator';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('mock/confirm')
  @RateLimit({ key: 'payments.mock_confirm', limit: 30, windowMs: 60 * 1000 })
  async confirm(@CurrentUser() actor: User, @Body() body: unknown) {
    const input = mockPaymentConfirmSchema.parse(body);
    return this.paymentsService.confirmMockPayment(actor, input.paymentId, input.providerEventId);
  }

  @Public()
  @Post('webhooks/mock')
  @RateLimit({ key: 'payments.mock_webhook', limit: 120, windowMs: 60 * 1000 })
  async mockWebhook(@Headers('x-mock-payment-signature') signature: string | undefined, @Body() body: unknown) {
    const input = mockPaymentWebhookSchema.parse(body);
    return this.paymentsService.handleMockWebhook(signature, input);
  }

  @Public()
  @Post('webhooks/razorpay')
  @RateLimit({ key: 'payments.razorpay_webhook', limit: 300, windowMs: 60 * 1000 })
  async razorpayWebhook(
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Body() body: unknown,
    @Req() request: { rawBody?: Buffer },
  ) {
    return this.paymentsService.handleRazorpayWebhook(signature, request.rawBody ?? Buffer.from(JSON.stringify(body)), body);
  }
}
