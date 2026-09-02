import { Module } from '@nestjs/common';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';
import { DispatchModule } from '../dispatch/dispatch.module';
import { PricingModule } from '../pricing/pricing.module';
import { ServiceZonesModule } from '../service-zones/service-zones.module';

@Module({
  imports: [DispatchModule, PricingModule, ServiceZonesModule],
  controllers: [DeliveriesController],
  providers: [DeliveriesService],
  exports: [DeliveriesService],
})
export class DeliveriesModule {}
