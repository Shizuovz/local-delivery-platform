import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/public.decorator';
import { PrismaService } from '../../common/prisma.service';

@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async health() {
    return {
      ok: true,
      persistence: await this.prisma.isHealthy(),
      timestamp: new Date().toISOString(),
    };
  }
}
