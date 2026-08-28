import { Module } from '@nestjs/common';
import { CoreModule } from './common/core.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { DeliveriesModule } from './modules/deliveries/deliveries.module';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { RidersModule } from './modules/riders/riders.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [CoreModule, HealthModule, AuthModule, DeliveriesModule, DispatchModule, PaymentsModule, RidersModule, AdminModule],
})
export class AppModule {}
