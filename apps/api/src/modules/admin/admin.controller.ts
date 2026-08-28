import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { adminAssignSchema } from '@local-delivery/validation';
import { User } from '@local-delivery/types';
import { CurrentUser } from '../../common/current-user.decorator';
import { RateLimit } from '../../common/rate-limit.decorator';
import { AdminService } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('deliveries')
  async deliveries(@CurrentUser() actor: User) {
    return this.adminService.listDeliveries(actor);
  }

  @Get('deliveries/:id/timeline')
  async timeline(@CurrentUser() actor: User, @Param('id') id: string) {
    return this.adminService.deliveryTimeline(actor, id);
  }

  @Post('deliveries/:id/assign')
  @RateLimit({ key: 'admin.assign', limit: 30, windowMs: 60 * 1000 })
  async assign(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const input = adminAssignSchema.parse(body);
    return this.adminService.assign(actor, id, input.riderId, input.reason);
  }

  @Post('deliveries/:id/reassign')
  @RateLimit({ key: 'admin.reassign', limit: 30, windowMs: 60 * 1000 })
  async reassign(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const input = adminAssignSchema.parse(body);
    return this.adminService.reassign(actor, id, input.riderId, input.reason);
  }

  @Get('audit-logs')
  async auditLogs(@CurrentUser() actor: User) {
    return this.adminService.auditLogs(actor);
  }
}
