import { Injectable } from '@nestjs/common';
import {
  AdminOperationsReport,
  AssignmentStatus,
  DeliveryStatus,
  PaymentStatus,
  Proof,
  RefundStatus,
  RiderAvailabilityStatus,
  RiderDocument,
  User,
} from '@local-delivery/types';
import { CacheService } from '../../common/cache.service';
import { ForbiddenError, NotFoundError } from '../../common/domain-errors';
import { InMemoryStore } from '../../common/in-memory-store';
import { ObjectStorageService } from '../../common/object-storage.service';
import { signProofFileUrl } from '../../common/proof-file-signing';
import { PrismaService } from '../../common/prisma.service';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { PaymentsService } from '../payments/payments.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly dispatchService: DispatchService,
    private readonly prisma: PrismaService,
    private readonly deliveriesService: DeliveriesService,
    private readonly cache: CacheService,
    private readonly storage: ObjectStorageService,
    private readonly paymentsService: PaymentsService,
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
      proofs: [...this.store.proofs.values()]
        .filter((proof) => proof.deliveryId === deliveryId)
        .map((proof) => this.toProof(proof)),
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

  async riderDocuments(actor: User, riderId: string) {
    this.requireAdmin(actor);
    if (this.prisma.isEnabled()) {
      const rider = await this.prisma.riderProfile.findUnique({ where: { userId: riderId } });
      if (!rider) throw new NotFoundError('Rider not found');
      const documents = await this.prisma.riderDocument.findMany({
        where: { riderId },
        orderBy: { createdAt: 'desc' },
      });
      return documents.map((document) => this.toRiderDocument({
        id: document.id,
        riderId: document.riderId,
        type: document.type,
        status: document.status as RiderDocument['status'],
        signedUrl: document.fileUrl ?? undefined,
        expiresAt: document.expiresAt?.toISOString(),
        retentionExpiresAt: document.retentionExpiresAt?.toISOString(),
        createdAt: document.createdAt.toISOString(),
      }));
    }

    if (!this.store.riders.has(riderId)) throw new NotFoundError('Rider not found');
    return [...this.store.riderDocuments.values()]
      .filter((document) => document.riderId === riderId)
      .map((document) => this.toRiderDocument(document));
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

  async operationsReport(actor: User): Promise<AdminOperationsReport> {
    this.requireAdmin(actor);
    const cacheKey = 'cache:v1:admin:operations-report';
    const ttlSeconds = 15;
    const cached = await this.cache.getJson<AdminOperationsReport>(cacheKey);
    if (cached) {
      return {
        ...cached,
        cache: { ...cached.cache, hit: true },
      };
    }

    const report = this.prisma.isEnabled()
      ? await this.operationsReportWithPrisma(cacheKey, ttlSeconds)
      : this.operationsReportFromMemory(cacheKey, ttlSeconds);
    await this.cache.setJson(cacheKey, report, { ttlSeconds });
    return report;
  }

  listPayments(actor: User) {
    this.requireAdmin(actor);
    if (this.prisma.isEnabled()) {
      return this.prisma.payment.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          delivery: true,
          refunds: { orderBy: { createdAt: 'desc' } },
          transactions: { orderBy: { createdAt: 'desc' }, take: 10 },
        },
      });
    }

    return [...this.store.payments.values()]
      .sort((left, right) => right.id.localeCompare(left.id))
      .map((payment) => ({
        ...payment,
        delivery: this.store.deliveries.get(payment.deliveryId),
        refunds: [...this.store.refunds.values()].filter((refund) => refund.paymentId === payment.id),
        transactions: [...this.store.paymentEvents.values()].map((providerEventId) => ({ providerEventId })),
      }));
  }

  reconcilePayment(actor: User, paymentId: string, reason: string) {
    this.requireAdmin(actor);
    return this.paymentsService.reconcilePayment(actor, paymentId, reason);
  }

  private requireAdmin(actor: User) {
    if (!actor.roles.includes('OPS_ADMIN') && !actor.roles.includes('SUPER_ADMIN')) {
      throw new ForbiddenError('Admin role required');
    }
  }

  private async operationsReportWithPrisma(cacheKey: string, ttlSeconds: number): Promise<AdminOperationsReport> {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const activeStatuses: DeliveryStatus[] = [
      DeliveryStatus.CONFIRMED,
      DeliveryStatus.SEARCHING_RIDER,
      DeliveryStatus.RIDER_ASSIGNED,
      DeliveryStatus.EN_ROUTE_PICKUP,
      DeliveryStatus.ARRIVED_PICKUP,
      DeliveryStatus.PICKED_UP,
      DeliveryStatus.EN_ROUTE_DROP,
      DeliveryStatus.ARRIVED_DROP,
      DeliveryStatus.RETURN_REQUIRED,
    ];
    const assignedStatuses: DeliveryStatus[] = [
      DeliveryStatus.RIDER_ASSIGNED,
      DeliveryStatus.EN_ROUTE_PICKUP,
      DeliveryStatus.ARRIVED_PICKUP,
      DeliveryStatus.PICKED_UP,
      DeliveryStatus.EN_ROUTE_DROP,
      DeliveryStatus.ARRIVED_DROP,
      DeliveryStatus.RETURN_REQUIRED,
    ];
    const staleCutoff = new Date(now.getTime() - 10 * 60 * 1000);

    const [
      active,
      searchingRider,
      assigned,
      deliveredToday,
      cancelledToday,
      failedOrDisputed,
      refundPending,
      paid,
      failedPayments,
      openSupport,
      inProgressSupport,
      closedToday,
      unassignedSearching,
      staleSearching,
    ] = await Promise.all([
      this.prisma.delivery.count({ where: { status: { in: activeStatuses } } }),
      this.prisma.delivery.count({ where: { status: DeliveryStatus.SEARCHING_RIDER } }),
      this.prisma.delivery.count({ where: { status: { in: assignedStatuses } } }),
      this.prisma.delivery.count({ where: { status: DeliveryStatus.DELIVERED, updatedAt: { gte: todayStart } } }),
      this.prisma.delivery.count({ where: { status: DeliveryStatus.CANCELLED, updatedAt: { gte: todayStart } } }),
      this.prisma.delivery.count({ where: { status: { in: [DeliveryStatus.FAILED, DeliveryStatus.DISPUTED] } } }),
      this.prisma.refund.count({ where: { status: { in: [RefundStatus.REQUESTED, RefundStatus.APPROVED, RefundStatus.PROCESSING] } } }),
      this.prisma.payment.count({ where: { status: PaymentStatus.PAID } }),
      this.prisma.payment.count({ where: { status: PaymentStatus.FAILED } }),
      this.prisma.supportTicket.count({ where: { status: 'OPEN' } }),
      this.prisma.supportTicket.count({ where: { status: 'IN_PROGRESS' } }),
      this.prisma.supportTicket.count({ where: { status: { in: ['RESOLVED', 'CLOSED'] }, updatedAt: { gte: todayStart } } }),
      this.prisma.delivery.count({ where: { status: DeliveryStatus.SEARCHING_RIDER, assignedRiderId: null } }),
      this.prisma.delivery.count({
        where: {
          status: DeliveryStatus.SEARCHING_RIDER,
          assignments: {
            none: {
              status: { in: [AssignmentStatus.OFFERED, AssignmentStatus.ACCEPTED] },
              updatedAt: { gte: staleCutoff },
            },
          },
        },
      }),
    ]);

    return {
      generatedAt: now.toISOString(),
      cache: { key: cacheKey, ttlSeconds, hit: false },
      deliveryCounts: {
        active,
        searchingRider,
        assigned,
        deliveredToday,
        cancelledToday,
        failedOrDisputed,
      },
      paymentCounts: {
        refundPending,
        paid,
        failed: failedPayments,
      },
      supportCounts: {
        open: openSupport,
        inProgress: inProgressSupport,
        closedToday,
      },
      dispatchCounts: {
        adminAttention: unassignedSearching + failedOrDisputed + openSupport + inProgressSupport,
        unassignedSearching,
        staleSearching,
      },
    };
  }

  private operationsReportFromMemory(cacheKey: string, ttlSeconds: number): AdminOperationsReport {
    const now = new Date();
    const todayStartMs = new Date(now).setHours(0, 0, 0, 0);
    const activeStatuses = new Set<DeliveryStatus>([
      DeliveryStatus.CONFIRMED,
      DeliveryStatus.SEARCHING_RIDER,
      DeliveryStatus.RIDER_ASSIGNED,
      DeliveryStatus.EN_ROUTE_PICKUP,
      DeliveryStatus.ARRIVED_PICKUP,
      DeliveryStatus.PICKED_UP,
      DeliveryStatus.EN_ROUTE_DROP,
      DeliveryStatus.ARRIVED_DROP,
      DeliveryStatus.RETURN_REQUIRED,
    ]);
    const assignedStatuses = new Set<DeliveryStatus>([
      DeliveryStatus.RIDER_ASSIGNED,
      DeliveryStatus.EN_ROUTE_PICKUP,
      DeliveryStatus.ARRIVED_PICKUP,
      DeliveryStatus.PICKED_UP,
      DeliveryStatus.EN_ROUTE_DROP,
      DeliveryStatus.ARRIVED_DROP,
      DeliveryStatus.RETURN_REQUIRED,
    ]);
    const deliveries = [...this.store.deliveries.values()];
    const payments = [...this.store.payments.values()];
    const refunds = [...this.store.refunds.values()];
    const tickets = [...this.store.supportTickets.values()];
    const assignments = [...this.store.assignments.values()];
    const staleCutoffMs = now.getTime() - 10 * 60 * 1000;
    const failedOrDisputed = deliveries.filter((delivery) => (
      delivery.status === DeliveryStatus.FAILED || delivery.status === DeliveryStatus.DISPUTED
    )).length;
    const openSupport = tickets.filter((ticket) => ticket.status === 'OPEN').length;
    const inProgressSupport = tickets.filter((ticket) => ticket.status === 'IN_PROGRESS').length;
    const unassignedSearching = deliveries.filter((delivery) => (
      delivery.status === DeliveryStatus.SEARCHING_RIDER && !delivery.assignedRiderId
    )).length;
    const staleSearching = deliveries.filter((delivery) => {
      if (delivery.status !== DeliveryStatus.SEARCHING_RIDER) return false;
      return !assignments.some((assignment) => (
        assignment.deliveryId === delivery.id
        && [AssignmentStatus.OFFERED, AssignmentStatus.ACCEPTED].includes(assignment.status)
        && Date.parse(assignment.acceptedAt ?? assignment.offeredAt) >= staleCutoffMs
      ));
    }).length;

    return {
      generatedAt: now.toISOString(),
      cache: { key: cacheKey, ttlSeconds, hit: false },
      deliveryCounts: {
        active: deliveries.filter((delivery) => activeStatuses.has(delivery.status)).length,
        searchingRider: deliveries.filter((delivery) => delivery.status === DeliveryStatus.SEARCHING_RIDER).length,
        assigned: deliveries.filter((delivery) => assignedStatuses.has(delivery.status)).length,
        deliveredToday: deliveries.filter((delivery) => delivery.status === DeliveryStatus.DELIVERED && Date.parse(delivery.updatedAt ?? delivery.createdAt) >= todayStartMs).length,
        cancelledToday: deliveries.filter((delivery) => delivery.status === DeliveryStatus.CANCELLED && Date.parse(delivery.updatedAt ?? delivery.createdAt) >= todayStartMs).length,
        failedOrDisputed,
      },
      paymentCounts: {
        refundPending: refunds.filter((refund) => [RefundStatus.REQUESTED, RefundStatus.APPROVED, RefundStatus.PROCESSING].includes(refund.status)).length,
        paid: payments.filter((payment) => payment.status === PaymentStatus.PAID).length,
        failed: payments.filter((payment) => payment.status === PaymentStatus.FAILED).length,
      },
      supportCounts: {
        open: openSupport,
        inProgress: inProgressSupport,
        closedToday: tickets.filter((ticket) => (
          ['RESOLVED', 'CLOSED'].includes(ticket.status)
          && Date.parse(ticket.createdAt) >= todayStartMs
        )).length,
      },
      dispatchCounts: {
        adminAttention: unassignedSearching + failedOrDisputed + openSupport + inProgressSupport,
        unassignedSearching,
        staleSearching,
      },
    };
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
      proofs: delivery?.proofs.map((proof) => this.toProof({
        id: proof.id,
        deliveryId: proof.deliveryId,
        type: proof.type as Proof['type'],
        createdBy: proof.createdBy,
        fileUrl: proof.fileUrl ?? undefined,
        otpVerified: proof.otpVerified,
        metadata: proof.metadata as Record<string, unknown> | undefined,
        retentionExpiresAt: proof.retentionExpiresAt?.toISOString(),
        createdAt: proof.createdAt.toISOString(),
      })) ?? [],
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

  private toProof(proof: Proof): Proof {
    const { fileUrl, ...safeProof } = proof;
    return {
      ...safeProof,
      signedUrl: fileUrl ? signProofFileUrl(proof.id) : undefined,
    };
  }

  private toRiderDocument(document: RiderDocument & { fileUrl?: string }): RiderDocument {
    const { signedUrl, fileUrl, ...safeDocument } = document;
    const fileRef = fileUrl ?? signedUrl;
    return {
      ...safeDocument,
      signedUrl: fileRef ? this.storage.signReadUrl(`/api/v1/rider/documents/${document.id}/file`, document.id) : undefined,
    };
  }
}
