import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  adminAssignSchema,
  adminBusinessStatusSchema,
  adminReasonSchema,
  adminRiderStatusSchema,
  adminSupportTicketStatusSchema,
} from '@local-delivery/validation';
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

  @Post('deliveries/:id/cancel')
  @RateLimit({ key: 'admin.cancel_delivery', limit: 30, windowMs: 60 * 1000 })
  async cancelDelivery(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const input = adminReasonSchema.parse(body);
    return this.adminService.cancelDelivery(actor, id, input.reason);
  }

  @Post('deliveries/:id/mark-exception')
  @RateLimit({ key: 'admin.mark_exception', limit: 30, windowMs: 60 * 1000 })
  async markException(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const input = adminReasonSchema.parse(body);
    return this.adminService.markDeliveryException(actor, id, input.reason);
  }

  @Post('riders/:id/approve')
  @RateLimit({ key: 'admin.approve_rider', limit: 30, windowMs: 60 * 1000 })
  async approveRider(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const input = adminReasonSchema.parse(body);
    return this.adminService.updateRiderStatus(actor, id, { approvalStatus: 'APPROVED', suspended: false }, input.reason);
  }

  @Patch('riders/:id/status')
  @RateLimit({ key: 'admin.rider_status', limit: 30, windowMs: 60 * 1000 })
  async riderStatus(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const input = adminRiderStatusSchema.parse(body);
    return this.adminService.updateRiderStatus(
      actor,
      id,
      { approvalStatus: input.approvalStatus, suspended: input.suspended },
      input.reason,
    );
  }

  @Patch('businesses/:id/status')
  @RateLimit({ key: 'admin.business_status', limit: 30, windowMs: 60 * 1000 })
  async businessStatus(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const input = adminBusinessStatusSchema.parse(body);
    return this.adminService.updateBusinessStatus(actor, id, input.status, input.reason);
  }

  @Get('support/tickets')
  async supportTickets(@CurrentUser() actor: User) {
    return this.adminService.listSupportTickets(actor);
  }

  @Patch('support/tickets/:id')
  @RateLimit({ key: 'admin.support_ticket_status', limit: 60, windowMs: 60 * 1000 })
  async updateSupportTicket(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const input = adminSupportTicketStatusSchema.parse(body);
    return this.adminService.updateSupportTicket(actor, id, input.status, input.reason);
  }

  @Get('audit-logs')
  async auditLogs(@CurrentUser() actor: User) {
    return this.adminService.auditLogs(actor);
  }

  @Get('reports/operations')
  async operationsReport(@CurrentUser() actor: User) {
    return this.adminService.operationsReport(actor);
  }
}
