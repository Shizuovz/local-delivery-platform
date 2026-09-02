import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/public.decorator';
import { ObservabilityService } from '../../common/observability.service';

@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly observability: ObservabilityService) {}

  @Get()
  async health() {
    return this.observability.health();
  }

  @Get('ready')
  async ready() {
    return this.observability.health();
  }

  @Get('metrics')
  async metrics() {
    return this.observability.metrics();
  }
}
