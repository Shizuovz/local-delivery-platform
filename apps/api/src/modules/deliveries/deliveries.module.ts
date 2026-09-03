import { Module } from '@nestjs/common';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';
import { DispatchModule } from '../dispatch/dispatch.module';
import { PaymentsModule } from '../payments/payments.module';
import { PricingModule } from '../pricing/pricing.module';
import { ServiceZonesModule } from '../service-zones/service-zones.module';

@Module({
  imports: [DispatchModule, PaymentsModule, PricingModule, ServiceZonesModule],
  controllers: [DeliveriesController],
  providers: [DeliveriesService],
  exports: [DeliveriesService],
})
export class DeliveriesModule {}
