import { Injectable } from '@nestjs/common';
import { AssignmentStatus, DeliveryStatus, RiderAvailabilityStatus, User } from '@local-delivery/types';
import { ForbiddenError, NotFoundError } from '../../common/domain-errors';
import { InMemoryStore } from '../../common/in-memory-store';
import { PrismaService } from '../../common/prisma.service';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { DispatchService } from '../dispatch/dispatch.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly dispatchService: DispatchService,
    private readonly prisma: PrismaService,
    private readonly deliveriesService: DeliveriesService,
  ) {}

  listDeliveries(actor: User) {
    this.requireAdmin(actor);
    if (this.prisma.isEnabled()) {
      return this.prisma.delivery.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          payments: { include: { refunds: true } },
          assignments: true,
        },
      });
    }

    return [...this.store.deliveries.values()].map((delivery) => ({
      ...delivery,
      payment: delivery.paymentId ? this.store.payments.get(delivery.paymentId) : undefined,
      refunds: delivery.paymentId
        ? [...this.store.refunds.values()].filter((refund) => refund.paymentId === delivery.paymentId)
        : [],
      assignments: [...this.store.assignments.values()].filter((assignment) => assignment.deliveryId === delivery.id),
    }));
  }

  deliveryTimeline(actor: User, deliveryId: string) {
    this.requireAdmin(actor);
    if (this.prisma.isEnabled()) {
      return this.deliveryTimelineWithPrisma(deliveryId);
    }

    return {
      delivery: this.store.deliveries.get(deliveryId),
      history: this.store.history.filter((event) => event.deliveryId === deliveryId),
      audits: this.store.auditLogs.filter((log) => log.entityId === deliveryId || log.metadata?.['deliveryId'] === deliveryId),
      proofs: [...this.store.proofs.values()].filter((proof) => proof.deliveryId === deliveryId),
      refunds: [...this.store.refunds.values()].filter((refund) => refund.paymentId === this.store.deliveries.get(deliveryId)?.paymentId),
      supportTickets: [...this.store.supportTickets.values()].filter((ticket) => ticket.deliveryId === deliveryId),
    };
  }

  assign(actor: User, deliveryId: string, riderId: string, reason: string) {
    this.requireAdmin(actor);
    return this.dispatchService.manuallyAssign(actor, deliveryId, riderId, reason, false);
  }

  reassign(actor: User, deliveryId: string, riderId: string, reason: string) {
    this.requireAdmin(actor);
    return this.dispatchService.manuallyAssign(actor, deliveryId, riderId, reason, true);
  }

  cancelDelivery(actor: User, deliveryId: string, reason: string) {
    this.requireAdmin(actor);
    return this.deliveriesService.cancel(actor, deliveryId, reason);
  }

  markDeliveryException(actor: User, deliveryId: string, reason: string) {
    this.requireAdmin(actor);
    if (this.prisma.isEnabled()) {
      return this.markDeliveryExceptionWithPrisma(actor, deliveryId, reason);
    }

    const delivery = this.store.deliveries.get(deliveryId);
    if (!delivery) throw new NotFoundError('Delivery not found');
    const existingTicket = [...this.store.supportTickets.values()].find((ticket) => (
      ticket.deliveryId === deliveryId
      && ticket.category === 'ADMIN_EXCEPTION'
      && ticket.status !== 'CLOSED'
    ));
    const ticket = existingTicket ?? {
      id: this.store.createId('ticket'),
      deliveryId,
      userId: actor.id,
      category: 'ADMIN_EXCEPTION',
      status: 'OPEN' as const,
      createdAt: this.store.now(),
    };
    this.store.supportTickets.set(ticket.id, ticket);
    this.store.writeHistory(deliveryId, delivery.status, actor.id, reason, { adminAttention: true, exception: true });
    this.store.writeAudit(actor.id, 'admin.delivery.mark_exception', 'delivery', deliveryId, reason, { ticketId: ticket.id });
    return { delivery, supportTicket: ticket };
  }

  updateRiderStatus(
    actor: User,
    riderId: string,
    input: { approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED'; suspended?: boolean },
    reason: string,
  ) {
    this.requireAdmin(actor);
    if (this.prisma.isEnabled()) {
      return this.updateRiderStatusWithPrisma(actor, riderId, input, reason);
    }

    const rider = this.store.riders.get(riderId);
    if (!rider) throw new NotFoundError('Rider not found');
    if (input.approvalStatus) rider.approvalStatus = input.approvalStatus;
    if (typeof input.suspended === 'boolean') rider.suspended = input.suspended;
    if (rider.suspended || rider.approvalStatus === 'REJECTED') {
      rider.availabilityStatus = RiderAvailabilityStatus.SUSPENDED;
      for (const assignment of this.store.assignments.values()) {
        if (assignment.riderId === riderId && assignment.status === 'OFFERED') {
          assignment.status = AssignmentStatus.CANCELLED;
        }
      }
    } else if (rider.availabilityStatus === RiderAvailabilityStatus.SUSPENDED) {
      rider.availabilityStatus = RiderAvailabilityStatus.OFFLINE;
    }
    this.store.writeAudit(actor.id, 'admin.rider.status_update', 'rider', riderId, reason, {
      approvalStatus: rider.approvalStatus,
      suspended: rider.suspended,
      availabilityStatus: rider.availabilityStatus,
    });
    return rider;
  }

  updateBusinessStatus(actor: User, businessId: string, status: 'PENDING' | 'APPROVED' | 'SUSPENDED', reason: string) {
    this.requireAdmin(actor);
    if (this.prisma.isEnabled()) {
      return this.updateBusinessStatusWithPrisma(actor, businessId, status, reason);
    }

    const business = this.store.businesses.get(businessId);
    if (!business) throw new NotFoundError('Business not found');
    business.status = status;
    this.store.writeAudit(actor.id, 'admin.business.status_update', 'business', businessId, reason, { status });
    return business;
  }

  listSupportTickets(actor: User) {
    this.requireAdmin(actor);
    if (this.prisma.isEnabled()) {
      return this.prisma.supportTicket.findMany({
        orderBy: { createdAt: 'desc' },
        include: { delivery: true },
      });
    }

    return [...this.store.supportTickets.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  updateSupportTicket(actor: User, ticketId: string, status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED', reason: string) {
    this.requireAdmin(actor);
    if (this.prisma.isEnabled()) {
      return this.updateSupportTicketWithPrisma(actor, ticketId, status, reason);
    }

    const ticket = this.store.supportTickets.get(ticketId);
    if (!ticket) throw new NotFoundError('Support ticket not found');
    ticket.status = status;
    this.store.writeAudit(actor.id, 'admin.support_ticket.status_update', 'support_ticket', ticketId, reason, {
      deliveryId: ticket.deliveryId,
      status,
    });
    return ticket;
  }

  auditLogs(actor: User) {
    this.requireAdmin(actor);
    if (this.prisma.isEnabled()) {
      return this.prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
    }

    return this.store.auditLogs;
  }

  private requireAdmin(actor: User) {
    if (!actor.roles.includes('OPS_ADMIN') && !actor.roles.includes('SUPER_ADMIN')) {
      throw new ForbiddenError('Admin role required');
    }
  }

  private async deliveryTimelineWithPrisma(deliveryId: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: {
        payments: { include: { refunds: true } },
        assignments: true,
        proofs: true,
        supportTickets: true,
        history: { orderBy: { timestamp: 'asc' } },
      },
    });
    return {
      delivery,
      history: delivery?.history ?? [],
      audits: await this.prisma.auditLog.findMany({
        where: {
          OR: [
            { entityId: deliveryId },
            { metadata: { path: ['deliveryId'], equals: deliveryId } },
          ],
        },
        orderBy: { createdAt: 'asc' },
      }),
      proofs: delivery?.proofs ?? [],
      refunds: delivery?.payments.flatMap((payment) => payment.refunds) ?? [],
      supportTickets: delivery?.supportTickets ?? [],
    };
  }

  private async markDeliveryExceptionWithPrisma(actor: User, deliveryId: string, reason: string) {
    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) throw new NotFoundError('Delivery not found');
    const result = await this.prisma.$transaction(async (tx) => {
      const existingTicket = await tx.supportTicket.findFirst({
        where: {
          deliveryId,
          category: 'ADMIN_EXCEPTION',
          status: { not: 'CLOSED' },
        },
      });
      const ticket = existingTicket ?? await tx.supportTicket.create({
        data: {
          deliveryId,
          userId: actor.id,
          category: 'ADMIN_EXCEPTION',
          status: 'OPEN',
        },
      });
      await tx.deliveryStatusHistory.create({
        data: {
          deliveryId,
          status: delivery.status as DeliveryStatus,
          actorId: actor.id,
          reason,
          metadata: { adminAttention: true, exception: true, ticketId: ticket.id },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'admin.delivery.mark_exception',
          entityType: 'delivery',
          entityId: deliveryId,
          reason,
          metadata: { ticketId: ticket.id },
        },
      });
      return ticket;
    });
    return { delivery, supportTicket: result };
  }

  private async updateRiderStatusWithPrisma(
    actor: User,
    riderId: string,
    input: { approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED'; suspended?: boolean },
    reason: string,
  ) {
    const rider = await this.prisma.riderProfile.findUnique({ where: { userId: riderId } });
    if (!rider) throw new NotFoundError('Rider not found');
    const suspended = input.suspended ?? rider.suspended;
    const approvalStatus = input.approvalStatus ?? rider.approvalStatus;
    const availabilityStatus = suspended || approvalStatus === 'REJECTED'
      ? 'SUSPENDED'
      : rider.availabilityStatus === 'SUSPENDED'
        ? 'OFFLINE'
        : rider.availabilityStatus;

    return this.prisma.$transaction(async (tx) => {
      if (suspended || approvalStatus === 'REJECTED') {
        await tx.assignment.updateMany({
          where: { riderId, status: 'OFFERED' },
          data: { status: 'CANCELLED' },
        });
      }
      const updated = await tx.riderProfile.update({
        where: { userId: riderId },
        data: {
          approvalStatus,
          suspended,
          availabilityStatus,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'admin.rider.status_update',
          entityType: 'rider',
          entityId: riderId,
          reason,
          metadata: {
            approvalStatus,
            suspended,
            availabilityStatus,
          },
        },
      });
      return updated;
    });
  }

  private async updateBusinessStatusWithPrisma(actor: User, businessId: string, status: 'PENDING' | 'APPROVED' | 'SUSPENDED', reason: string) {
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundError('Business not found');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.business.update({
        where: { id: businessId },
        data: { status },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'admin.business.status_update',
          entityType: 'business',
          entityId: businessId,
          reason,
          metadata: { status },
        },
      });
      return updated;
    });
  }

  private async updateSupportTicketWithPrisma(actor: User, ticketId: string, status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED', reason: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundError('Support ticket not found');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.supportTicket.update({
        where: { id: ticketId },
        data: { status },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'admin.support_ticket.status_update',
          entityType: 'support_ticket',
          entityId: ticketId,
          reason,
          metadata: {
            deliveryId: ticket.deliveryId,
            status,
          },
        },
      });
      return updated;
    });
  }
}
