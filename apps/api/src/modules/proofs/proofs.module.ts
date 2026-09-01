import { Module } from '@nestjs/common';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { ProofsController } from './proofs.controller';
import { ProofsService } from './proofs.service';

@Module({
  imports: [DeliveriesModule],
  controllers: [ProofsController],
  providers: [ProofsService],
})
export class ProofsModule {}
