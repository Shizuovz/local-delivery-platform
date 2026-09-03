import { Module } from '@nestjs/common';
import { CoreModule } from '../../common/core.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { PaymentsModule } from '../payments/payments.module';
import { PricingModule } from '../pricing/pricing.module';
import { ServiceZonesModule } from '../service-zones/service-zones.module';
import { BusinessesController } from './businesses.controller';
import { BusinessesService } from './businesses.service';

@Module({
  imports: [CoreModule, DispatchModule, PaymentsModule, PricingModule, ServiceZonesModule],
  controllers: [BusinessesController],
  providers: [BusinessesService],
  exports: [BusinessesService],
})
export class BusinessesModule {}
