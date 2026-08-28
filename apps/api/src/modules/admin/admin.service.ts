import { Injectable } from '@nestjs/common';
import { User } from '@local-delivery/types';
import { ForbiddenError } from '../../common/domain-errors';
import { InMemoryStore } from '../../common/in-memory-store';
import { PrismaService } from '../../common/prisma.service';
import { DispatchService } from '../dispatch/dispatch.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly dispatchService: DispatchService,
    private readonly prisma: PrismaService,
  ) {}

  listDeliveries(actor: User) {
    this.requireAdmin(actor);
    if (this.prisma.isEnabled()) {
      return this.prisma.delivery.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          payments: true,
          assignments: true,
        },
      });
    }

    return [...this.store.deliveries.values()].map((delivery) => ({
      ...delivery,
      payment: delivery.paymentId ? this.store.payments.get(delivery.paymentId) : undefined,
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
        payments: true,
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
      supportTickets: delivery?.supportTickets ?? [],
    };
  }
}
