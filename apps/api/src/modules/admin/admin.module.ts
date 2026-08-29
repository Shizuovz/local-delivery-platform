import { Module } from '@nestjs/common';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [DeliveriesModule, DispatchModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
