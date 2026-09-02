import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CoreModule } from './common/core.module';
import { StructuredRequestLoggerMiddleware } from './common/structured-request-logger.middleware';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { BusinessesModule } from './modules/businesses/businesses.module';
import { DeliveriesModule } from './modules/deliveries/deliveries.module';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { ProofsModule } from './modules/proofs/proofs.module';
import { RidersModule } from './modules/riders/riders.module';
import { HealthModule } from './modules/health/health.module';
import { ServiceZonesModule } from './modules/service-zones/service-zones.module';

@Module({
  imports: [CoreModule, HealthModule, AuthModule, ServiceZonesModule, PricingModule, DeliveriesModule, DispatchModule, PaymentsModule, ProofsModule, RidersModule, BusinessesModule, AdminModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(StructuredRequestLoggerMiddleware).forRoutes('*');
  }
}
