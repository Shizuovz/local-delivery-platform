import { Module } from '@nestjs/common';
import { ObservabilityService } from '../../common/observability.service';
import { DispatchModule } from '../dispatch/dispatch.module';
import { HealthController } from './health.controller';

@Module({
  imports: [DispatchModule],
  controllers: [HealthController],
  providers: [ObservabilityService],
})
export class HealthModule {}
