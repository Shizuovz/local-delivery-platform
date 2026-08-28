import { Module } from '@nestjs/common';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { RidersController } from './riders.controller';
import { RidersService } from './riders.service';

@Module({
  imports: [DeliveriesModule, DispatchModule],
  controllers: [RidersController],
  providers: [RidersService],
})
export class RidersModule {}
