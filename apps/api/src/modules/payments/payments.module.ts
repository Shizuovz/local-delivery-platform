import { Module } from '@nestjs/common';
import { DispatchModule } from '../dispatch/dispatch.module';
import { PaymentProviderService } from './payment-provider.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [DispatchModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentProviderService],
  exports: [PaymentsService, PaymentProviderService],
})
export class PaymentsModule {}
