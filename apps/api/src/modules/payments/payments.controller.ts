import { Body, Controller, Post } from '@nestjs/common';
import { mockPaymentConfirmSchema } from '@local-delivery/validation';
import { User } from '@local-delivery/types';
import { CurrentUser } from '../../common/current-user.decorator';
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
}
