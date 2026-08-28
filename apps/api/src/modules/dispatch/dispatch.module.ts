import { Module } from '@nestjs/common';
import { DispatchController } from './dispatch.controller';
import { DispatchQueueService } from './dispatch.queue';
import { DispatchService } from './dispatch.service';

@Module({
  controllers: [DispatchController],
  providers: [DispatchService, DispatchQueueService],
  exports: [DispatchService, DispatchQueueService],
})
export class DispatchModule {}
