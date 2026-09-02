import { Body, Controller, Get, Post } from '@nestjs/common';
import { adminServiceZoneSchema } from '@local-delivery/validation';
import { User } from '@local-delivery/types';
import { CurrentUser } from '../../common/current-user.decorator';
import { Public } from '../../common/public.decorator';
import { RateLimit } from '../../common/rate-limit.decorator';
import { ServiceZonesService } from './service-zones.service';

@Controller()
export class ServiceZonesController {
  constructor(private readonly serviceZones: ServiceZonesService) {}

  @Public()
  @Get('service-zones')
  activeZones() {
    return this.serviceZones.list();
  }

  @Get('admin/service-zones')
  adminZones(@CurrentUser() actor: User) {
    return this.serviceZones.list(actor);
  }

  @Post('admin/service-zones')
  @RateLimit({ key: 'admin.service_zone', limit: 30, windowMs: 60 * 1000 })
  upsert(@CurrentUser() actor: User, @Body() body: unknown) {
    const input = adminServiceZoneSchema.parse(body);
    return this.serviceZones.upsert(actor, input);
  }
}
