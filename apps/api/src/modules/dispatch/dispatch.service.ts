import { Injectable } from '@nestjs/common';
import {
  Assignment,
  AssignmentStatus,
  DeliveryStatus,
  RiderAvailabilityStatus,
  RiderProfile,
  User,
} from '@local-delivery/types';
import { ConflictError, ForbiddenError, NotFoundError } from '../../common/domain-errors';
import { InMemoryStore } from '../../common/in-memory-store';
import { PrismaService } from '../../common/prisma.service';

const OFFER_TTL_MS = 30_000;
const LOCATION_FRESH_MS = 5 * 60_000;
const MAX_AUTO_ASSIGNMENT_ATTEMPTS = 3;
const DISPATCH_ADMIN_ATTENTION_CATEGORY = 'DISPATCH_UNASSIGNED';

@Injectable()
export class DispatchService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly prisma: PrismaService,
  ) {}

  dispatchDelivery(deliveryId: string) {
    if (this.prisma?.isEnabled()) {
      return this.dispatchDeliveryWithPrisma(deliveryId);
    }

    const delivery = this.store.deliveries.get(deliveryId);
    if (!delivery) throw new NotFoundError('Delivery not found');
    if (![DeliveryStatus.CONFIRMED, DeliveryStatus.SEARCHING_RIDER].includes(delivery.status)) {
      throw new ConflictError(`Delivery cannot be dispatched from ${delivery.status}`);
    }

    const activeOffer = this.activeOfferForDelivery(delivery.id);
    if (activeOffer) {
      return { delivery, offeredAssignment: activeOffer, adminAttention: false, existingOffer: true };
    }

    if (delivery.status !== DeliveryStatus.SEARCHING_RIDER) {
      delivery.status = DeliveryStatus.SEARCHING_RIDER;
      delivery.updatedAt = this.store.now();
      this.store.writeHistory(delivery.id, DeliveryStatus.SEARCHING_RIDER, undefined, 'Dispatch started');
    }

    const rider = this.findEligibleRiders(delivery.id)[0];
    const attempts = this.assignmentAttemptsForDelivery(delivery.id);
    if (!rider) {
      this.markAdminAttention(delivery.id, delivery.customerId ?? 'system', 'No eligible riders');
      return { delivery, offeredAssignment: null, adminAttention: true };
    }
    if (attempts >= MAX_AUTO_ASSIGNMENT_ATTEMPTS) {
      this.markAdminAttention(delivery.id, delivery.customerId ?? 'system', 'Assignment attempts exhausted');
      return { delivery, offeredAssignment: null, adminAttention: true };
    }

    const assignment: Assignment = {
      id: this.store.createId('asg'),
      deliveryId: delivery.id,
      riderId: rider.userId,
      status: AssignmentStatus.OFFERED,
      offeredAt: this.store.now(),
      expiresAt: new Date(Date.now() + OFFER_TTL_MS).toISOString(),
    };

    this.store.assignments.set(assignment.id, assignment);
    rider.availabilityStatus = RiderAvailabilityStatus.OFFERED_JOB;
    this.store.writeAudit('system', 'assignment.offer', 'assignment', assignment.id, undefined, { deliveryId: delivery.id, riderId: rider.userId, attempt: attempts + 1 });
    return { delivery, offeredAssignment: assignment, adminAttention: false };
  }

  acceptAssignment(actor: User, assignmentId: string) {
    if (this.prisma?.isEnabled()) {
      return this.acceptAssignmentWithPrisma(actor, assignmentId);
    }

    const rider = this.requireRider(actor);
    const assignment = this.store.assignments.get(assignmentId);
    if (!assignment) throw new NotFoundError('Assignment not found');
    if (assignment.riderId !== actor.id) throw new ForbiddenError('Assignment is not offered to this rider');
    if (assignment.status !== AssignmentStatus.OFFERED) throw new ConflictError(`Assignment is ${assignment.status}`);
    if (assignment.expiresAt && Date.parse(assignment.expiresAt) < Date.now()) {
      assignment.status = AssignmentStatus.EXPIRED;
      throw new ConflictError('Assignment offer expired');
    }

    const delivery = this.store.deliveries.get(assignment.deliveryId);
    if (!delivery) throw new NotFoundError('Delivery not found');
    const alreadyAccepted = [...this.store.assignments.values()].find((candidate) => candidate.deliveryId === delivery.id && candidate.status === AssignmentStatus.ACCEPTED);
    if (alreadyAccepted && alreadyAccepted.id !== assignment.id) {
      throw new ConflictError('Delivery already has an accepted assignment');
    }
    if (!this.isRiderEligible(rider, RiderAvailabilityStatus.OFFERED_JOB)) {
      throw new ConflictError('Rider is no longer eligible');
    }

    assignment.status = AssignmentStatus.ACCEPTED;
    assignment.acceptedAt = this.store.now();
    delivery.assignedRiderId = actor.id;
    delivery.status = DeliveryStatus.RIDER_ASSIGNED;
    delivery.updatedAt = this.store.now();
    rider.availabilityStatus = RiderAvailabilityStatus.ON_ACTIVE_DELIVERY;

    for (const other of this.store.assignments.values()) {
      if (other.deliveryId === delivery.id && other.id !== assignment.id && other.status === AssignmentStatus.OFFERED) {
        other.status = AssignmentStatus.CANCELLED;
      }
    }

    this.store.writeHistory(delivery.id, DeliveryStatus.RIDER_ASSIGNED, actor.id, 'Rider accepted assignment');
    this.store.writeAudit(actor.id, 'assignment.accept', 'assignment', assignment.id);
    return { delivery, assignment };
  }

  rejectAssignment(actor: User, assignmentId: string) {
    if (this.prisma?.isEnabled()) {
      return this.rejectAssignmentWithPrisma(actor, assignmentId);
    }

    this.requireRider(actor);
    const assignment = this.store.assignments.get(assignmentId);
    if (!assignment) throw new NotFoundError('Assignment not found');
    if (assignment.riderId !== actor.id) throw new ForbiddenError('Assignment is not offered to this rider');
    if (assignment.status !== AssignmentStatus.OFFERED) throw new ConflictError(`Assignment is ${assignment.status}`);
    assignment.status = AssignmentStatus.REJECTED;
    const rider = this.store.riders.get(assignment.riderId);
    if (rider?.availabilityStatus === RiderAvailabilityStatus.OFFERED_JOB) {
      rider.availabilityStatus = RiderAvailabilityStatus.ONLINE_IDLE;
    }
    this.store.writeAudit(actor.id, 'assignment.reject', 'assignment', assignment.id);
    this.store.writeHistory(assignment.deliveryId, DeliveryStatus.SEARCHING_RIDER, actor.id, 'Rider rejected offer', { assignmentId });
    return {
      rejectedAssignment: assignment,
      nextDispatch: this.dispatchDelivery(assignment.deliveryId),
    };
  }

  expireOffer(assignmentId: string) {
    if (this.prisma?.isEnabled()) {
      return this.expireOfferWithPrisma(assignmentId);
    }

    const assignment = this.store.assignments.get(assignmentId);
    if (!assignment) throw new NotFoundError('Assignment not found');
    if (assignment.status === AssignmentStatus.OFFERED) {
      assignment.status = AssignmentStatus.EXPIRED;
      const rider = this.store.riders.get(assignment.riderId);
      if (rider?.availabilityStatus === RiderAvailabilityStatus.OFFERED_JOB) {
        rider.availabilityStatus = RiderAvailabilityStatus.ONLINE_IDLE;
      }
      this.store.writeHistory(assignment.deliveryId, DeliveryStatus.SEARCHING_RIDER, undefined, 'Rider offer expired', { assignmentId });
      this.store.writeAudit('system', 'assignment.expire', 'assignment', assignment.id, undefined, { deliveryId: assignment.deliveryId, riderId: assignment.riderId });
      return {
        expiredAssignment: assignment,
        nextDispatch: this.dispatchDelivery(assignment.deliveryId),
      };
    }
    return assignment;
  }

  findOffersForRider(riderId: string) {
    if (this.prisma?.isEnabled()) {
      return this.findOffersForRiderWithPrisma(riderId);
    }

    return [...this.store.assignments.values()].filter((assignment) => assignment.riderId === riderId && assignment.status === AssignmentStatus.OFFERED);
  }

  manuallyAssign(actor: User, deliveryId: string, riderId: string, reason: string, reassign = false) {
    if (this.prisma?.isEnabled()) {
      return this.manuallyAssignWithPrisma(actor, deliveryId, riderId, reason, reassign);
    }

    if (!actor.roles.includes('OPS_ADMIN') && !actor.roles.includes('SUPER_ADMIN')) {
      throw new ForbiddenError('Admin role required');
    }
    const delivery = this.store.deliveries.get(deliveryId);
    if (!delivery) throw new NotFoundError('Delivery not found');
    const rider = this.store.riders.get(riderId);
    if (!rider) throw new NotFoundError('Rider not found');
    if (!this.isRiderEligible(rider)) throw new ConflictError('Rider is not eligible');

    for (const existing of this.store.assignments.values()) {
      if (existing.deliveryId === delivery.id && [AssignmentStatus.OFFERED, AssignmentStatus.ACCEPTED].includes(existing.status)) {
        existing.status = reassign ? AssignmentStatus.REASSIGNED : AssignmentStatus.CANCELLED;
      }
    }

    const assignment: Assignment = {
      id: this.store.createId('asg'),
      deliveryId: delivery.id,
      riderId,
      status: AssignmentStatus.ACCEPTED,
      offeredAt: this.store.now(),
      acceptedAt: this.store.now(),
    };

    this.store.assignments.set(assignment.id, assignment);
    delivery.assignedRiderId = riderId;
    delivery.status = DeliveryStatus.RIDER_ASSIGNED;
    delivery.updatedAt = this.store.now();
    rider.availabilityStatus = RiderAvailabilityStatus.ON_ACTIVE_DELIVERY;
    this.store.writeHistory(delivery.id, DeliveryStatus.RIDER_ASSIGNED, actor.id, reason);
    this.store.writeAudit(actor.id, reassign ? 'admin.reassign' : 'admin.assign', 'delivery', delivery.id, reason, { riderId });
    return { delivery, assignment };
  }

  private async dispatchDeliveryWithPrisma(deliveryId: string) {
    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) throw new NotFoundError('Delivery not found');
    if (![DeliveryStatus.CONFIRMED, DeliveryStatus.SEARCHING_RIDER].includes(delivery.status as DeliveryStatus)) {
      throw new ConflictError(`Delivery cannot be dispatched from ${delivery.status}`);
    }

    const activeOffer = await this.activeOfferForDeliveryWithPrisma(delivery.id);
    if (activeOffer) {
      return { delivery: this.toDelivery(delivery), offeredAssignment: this.toAssignment(activeOffer), adminAttention: false, existingOffer: true };
    }

    const rider = (await this.findEligibleRidersWithPrisma(delivery.id))[0];
    const attempts = await this.assignmentAttemptsForDeliveryWithPrisma(delivery.id);
    const updatedDelivery = delivery.status === 'SEARCHING_RIDER'
      ? delivery
      : await this.prisma.$transaction(async (tx) => {
        const updated = await tx.delivery.update({
          where: { id: delivery.id },
          data: { status: 'SEARCHING_RIDER' },
        });
        await tx.deliveryStatusHistory.create({
          data: {
            deliveryId: delivery.id,
            status: 'SEARCHING_RIDER',
            reason: 'Dispatch started',
          },
        });
        return updated;
      });

    if (!rider || attempts >= MAX_AUTO_ASSIGNMENT_ATTEMPTS) {
      await this.markAdminAttentionWithPrisma(
        delivery.id,
        delivery.customerId,
        attempts >= MAX_AUTO_ASSIGNMENT_ATTEMPTS ? 'Assignment attempts exhausted' : 'No eligible riders',
      );
      return { delivery: this.toDelivery(updatedDelivery), offeredAssignment: null, adminAttention: true };
    }

    const systemActorId = await this.systemActorId();
    const assignment = await this.prisma.$transaction(async (tx) => {
      const offered = await tx.assignment.create({
        data: {
          deliveryId: delivery.id,
          riderId: rider.userId,
          status: 'OFFERED',
          expiresAt: new Date(Date.now() + OFFER_TTL_MS),
        },
      });
      await tx.riderProfile.update({
        where: { userId: rider.userId },
        data: { availabilityStatus: 'OFFERED_JOB' },
      });
      await tx.auditLog.create({
        data: {
          actorId: systemActorId,
          action: 'assignment.offer',
          entityType: 'assignment',
          entityId: offered.id,
          metadata: { deliveryId: delivery.id, riderId: rider.userId, attempt: attempts + 1 },
        },
      });
      return offered;
    });

    return { delivery: this.toDelivery(updatedDelivery), offeredAssignment: this.toAssignment(assignment), adminAttention: false };
  }

  private async acceptAssignmentWithPrisma(actor: User, assignmentId: string) {
    await this.requireRiderWithPrisma(actor);
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: { delivery: true, rider: true },
    });
    if (!assignment) throw new NotFoundError('Assignment not found');
    if (assignment.riderId !== actor.id) throw new ForbiddenError('Assignment is not offered to this rider');
    if (assignment.status !== 'OFFERED') throw new ConflictError(`Assignment is ${assignment.status}`);
    if (assignment.expiresAt && assignment.expiresAt.getTime() < Date.now()) {
      await this.prisma.assignment.update({ where: { id: assignment.id }, data: { status: 'EXPIRED' } });
      throw new ConflictError('Assignment offer expired');
    }
    if (!(await this.isRiderEligibleWithPrisma(actor.id, RiderAvailabilityStatus.OFFERED_JOB))) {
      throw new ConflictError('Rider is no longer eligible');
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const accepted = await tx.assignment.update({
          where: { id: assignment.id },
          data: {
            status: 'ACCEPTED',
            acceptedAt: new Date(),
            acceptedDeliveryKey: assignment.deliveryId,
          },
        });
        await tx.assignment.updateMany({
          where: {
            deliveryId: assignment.deliveryId,
            id: { not: assignment.id },
            status: 'OFFERED',
          },
          data: { status: 'CANCELLED' },
        });
        const delivery = await tx.delivery.update({
          where: { id: assignment.deliveryId },
          data: {
            assignedRiderId: actor.id,
            status: 'RIDER_ASSIGNED',
          },
        });
        await tx.riderProfile.update({
          where: { userId: actor.id },
          data: { availabilityStatus: 'ON_ACTIVE_DELIVERY' },
        });
        await tx.deliveryStatusHistory.create({
          data: {
            deliveryId: delivery.id,
            status: 'RIDER_ASSIGNED',
            actorId: actor.id,
            reason: 'Rider accepted assignment',
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: 'assignment.accept',
            entityType: 'assignment',
            entityId: assignment.id,
            metadata: { deliveryId: delivery.id },
          },
        });
        return { delivery, assignment: accepted };
      });
      return { delivery: this.toDelivery(result.delivery), assignment: this.toAssignment(result.assignment) };
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictError('Delivery already has an accepted assignment');
      }
      throw error;
    }
  }

  private async rejectAssignmentWithPrisma(actor: User, assignmentId: string) {
    await this.requireRiderWithPrisma(actor);
    const assignment = await this.prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) throw new NotFoundError('Assignment not found');
    if (assignment.riderId !== actor.id) throw new ForbiddenError('Assignment is not offered to this rider');
    if (assignment.status !== 'OFFERED') throw new ConflictError(`Assignment is ${assignment.status}`);
    const rejected = await this.prisma.assignment.update({
      where: { id: assignment.id },
      data: { status: 'REJECTED' },
    });
    await this.prisma.riderProfile.updateMany({
      where: { userId: assignment.riderId, availabilityStatus: 'OFFERED_JOB' },
      data: { availabilityStatus: 'ONLINE_IDLE' },
    });
    await this.prisma.deliveryStatusHistory.create({
      data: {
        deliveryId: assignment.deliveryId,
        status: 'SEARCHING_RIDER',
        actorId: actor.id,
        reason: 'Rider rejected offer',
        metadata: { assignmentId },
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'assignment.reject',
        entityType: 'assignment',
        entityId: assignment.id,
        metadata: { deliveryId: assignment.deliveryId },
      },
    });
    return {
      rejectedAssignment: this.toAssignment(rejected),
      nextDispatch: await this.dispatchDeliveryWithPrisma(assignment.deliveryId),
    };
  }

  private async expireOfferWithPrisma(assignmentId: string) {
    const assignment = await this.prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) throw new NotFoundError('Assignment not found');
    if (assignment.status !== 'OFFERED') return this.toAssignment(assignment);
    const systemActorId = await this.systemActorId();
    const expired = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.assignment.update({
        where: { id: assignmentId },
        data: { status: 'EXPIRED' },
      });
      await tx.riderProfile.updateMany({
        where: { userId: assignment.riderId, availabilityStatus: 'OFFERED_JOB' },
        data: { availabilityStatus: 'ONLINE_IDLE' },
      });
      await tx.deliveryStatusHistory.create({
        data: {
          deliveryId: assignment.deliveryId,
          status: 'SEARCHING_RIDER',
          reason: 'Rider offer expired',
          metadata: { assignmentId },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: systemActorId,
          action: 'assignment.expire',
          entityType: 'assignment',
          entityId: assignment.id,
          metadata: { deliveryId: assignment.deliveryId, riderId: assignment.riderId },
        },
      });
      return updated;
    });
    const delivery = await this.prisma.delivery.findUnique({ where: { id: assignment.deliveryId } });
    if (delivery?.status === 'SEARCHING_RIDER') {
      return {
        expiredAssignment: this.toAssignment(expired),
        nextDispatch: await this.dispatchDeliveryWithPrisma(assignment.deliveryId),
      };
    }
    return this.toAssignment(expired);
  }

  private async findOffersForRiderWithPrisma(riderId: string) {
    await this.prisma.assignment.updateMany({
      where: {
        riderId,
        status: 'OFFERED',
        expiresAt: { lt: new Date() },
      },
      data: { status: 'EXPIRED' },
    });
    const offers = await this.prisma.assignment.findMany({
      where: {
        riderId,
        status: 'OFFERED',
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: { offeredAt: 'desc' },
    });
    return offers.map((offer) => this.toAssignment(offer));
  }

  private async manuallyAssignWithPrisma(actor: User, deliveryId: string, riderId: string, reason: string, reassign = false) {
    if (!actor.roles.includes('OPS_ADMIN') && !actor.roles.includes('SUPER_ADMIN')) {
      throw new ForbiddenError('Admin role required');
    }
    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) throw new NotFoundError('Delivery not found');
    await this.requireRiderByIdWithPrisma(riderId);
    if (!(await this.isRiderEligibleWithPrisma(riderId))) throw new ConflictError('Rider is not eligible');

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.assignment.updateMany({
          where: { deliveryId, status: { in: ['OFFERED', 'ACCEPTED'] } },
          data: { status: reassign ? 'REASSIGNED' : 'CANCELLED', acceptedDeliveryKey: null },
        });
        const assignment = await tx.assignment.create({
          data: {
            deliveryId,
            riderId,
            status: 'ACCEPTED',
            acceptedAt: new Date(),
            acceptedDeliveryKey: deliveryId,
          },
        });
        const updatedDelivery = await tx.delivery.update({
          where: { id: deliveryId },
          data: { assignedRiderId: riderId, status: 'RIDER_ASSIGNED' },
        });
        await tx.riderProfile.update({
          where: { userId: riderId },
          data: { availabilityStatus: 'ON_ACTIVE_DELIVERY' },
        });
        await tx.deliveryStatusHistory.create({
          data: {
            deliveryId,
            status: 'RIDER_ASSIGNED',
            actorId: actor.id,
            reason,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: reassign ? 'admin.reassign' : 'admin.assign',
            entityType: 'delivery',
            entityId: deliveryId,
            reason,
            metadata: { riderId, assignmentId: assignment.id },
          },
        });
        return { delivery: updatedDelivery, assignment };
      });
      return { delivery: this.toDelivery(result.delivery), assignment: this.toAssignment(result.assignment) };
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictError('Delivery already has an accepted assignment');
      }
      throw error;
    }
  }

  private findEligibleRiders(deliveryId?: string) {
    const skippedRiders = deliveryId ? this.ridersAlreadyTriedForDelivery(deliveryId) : new Set<string>();
    return [...this.store.riders.values()].filter((rider) => !skippedRiders.has(rider.userId) && this.isRiderEligible(rider));
  }

  private activeOfferForDelivery(deliveryId: string) {
    return [...this.store.assignments.values()].find((assignment) => (
      assignment.deliveryId === deliveryId
      && assignment.status === AssignmentStatus.OFFERED
      && (!assignment.expiresAt || Date.parse(assignment.expiresAt) > Date.now())
    ));
  }

  private ridersAlreadyTriedForDelivery(deliveryId: string) {
    return new Set(
      [...this.store.assignments.values()]
        .filter((assignment) => assignment.deliveryId === deliveryId)
        .map((assignment) => assignment.riderId),
    );
  }

  private assignmentAttemptsForDelivery(deliveryId: string) {
    return [...this.store.assignments.values()].filter((assignment) => assignment.deliveryId === deliveryId).length;
  }

  private markAdminAttention(deliveryId: string, actorId: string, reason: string) {
    const existing = [...this.store.supportTickets.values()].find((ticket) => ticket.deliveryId === deliveryId && ticket.category === DISPATCH_ADMIN_ATTENTION_CATEGORY && ticket.status !== 'CLOSED');
    if (!existing) {
      const ticketId = this.store.createId('ticket');
      this.store.supportTickets.set(ticketId, {
        id: ticketId,
        deliveryId,
        userId: actorId,
        category: DISPATCH_ADMIN_ATTENTION_CATEGORY,
        status: 'OPEN',
        createdAt: this.store.now(),
      });
    }
    this.store.writeHistory(deliveryId, DeliveryStatus.SEARCHING_RIDER, undefined, reason, { adminAttention: true });
    this.store.writeAudit(actorId, 'dispatch.admin_attention', 'delivery', deliveryId, reason);
  }

  private isRiderEligible(rider: RiderProfile, allowedStatus = RiderAvailabilityStatus.ONLINE_IDLE) {
    const location = this.store.locations.get(rider.userId);
    const hasFreshLocation = location ? Date.parse(location.recordedAt) >= Date.now() - LOCATION_FRESH_MS : false;
    return rider.approvalStatus === 'APPROVED'
      && !rider.suspended
      && rider.availabilityStatus === allowedStatus
      && hasFreshLocation;
  }

  private requireRider(actor: User) {
    if (!actor.roles.includes('RIDER')) throw new ForbiddenError('Rider role required');
    const rider = this.store.riders.get(actor.id);
    if (!rider) throw new ForbiddenError('Rider profile missing');
    return rider;
  }

  private async findEligibleRidersWithPrisma(deliveryId?: string) {
    const skippedRiders = deliveryId
      ? (await this.prisma.assignment.findMany({
        where: { deliveryId },
        select: { riderId: true },
      })).map((assignment) => assignment.riderId)
      : [];
    const riders = await this.prisma.riderProfile.findMany({
      where: {
        approvalStatus: 'APPROVED',
        suspended: false,
        availabilityStatus: 'ONLINE_IDLE',
        userId: skippedRiders.length ? { notIn: skippedRiders } : undefined,
      },
      include: {
        locations: {
          orderBy: { recordedAt: 'desc' },
          take: 1,
        },
      },
    });
    return riders.filter((rider) => {
      const location = rider.locations[0];
      return location ? location.recordedAt.getTime() >= Date.now() - LOCATION_FRESH_MS : false;
    });
  }

  private activeOfferForDeliveryWithPrisma(deliveryId: string) {
    return this.prisma.assignment.findFirst({
      where: {
        deliveryId,
        status: 'OFFERED',
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: { offeredAt: 'desc' },
    });
  }

  private assignmentAttemptsForDeliveryWithPrisma(deliveryId: string) {
    return this.prisma.assignment.count({ where: { deliveryId } });
  }

  private async markAdminAttentionWithPrisma(deliveryId: string, actorId: string | null, reason: string) {
    const systemActorId = actorId ?? await this.systemActorId();
    await this.prisma.$transaction(async (tx) => {
      const existingTicket = await tx.supportTicket.findFirst({
        where: {
          deliveryId,
          category: DISPATCH_ADMIN_ATTENTION_CATEGORY,
          status: { not: 'CLOSED' },
        },
      });
      if (!existingTicket) {
        await tx.supportTicket.create({
          data: {
            deliveryId,
            userId: systemActorId,
            category: DISPATCH_ADMIN_ATTENTION_CATEGORY,
            status: 'OPEN',
          },
        });
      }
      await tx.deliveryStatusHistory.create({
        data: {
          deliveryId,
          status: 'SEARCHING_RIDER',
          reason,
          metadata: { adminAttention: true },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: systemActorId,
          action: 'dispatch.admin_attention',
          entityType: 'delivery',
          entityId: deliveryId,
          reason,
        },
      });
    });
  }

  private async isRiderEligibleWithPrisma(riderId: string, allowedStatus = RiderAvailabilityStatus.ONLINE_IDLE) {
    const rider = await this.prisma.riderProfile.findUnique({
      where: { userId: riderId },
      include: {
        locations: {
          orderBy: { recordedAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!rider) return false;
    const location = rider.locations[0];
    const hasFreshLocation = location ? location.recordedAt.getTime() >= Date.now() - LOCATION_FRESH_MS : false;
    return rider.approvalStatus === 'APPROVED'
      && !rider.suspended
      && rider.availabilityStatus === allowedStatus
      && hasFreshLocation;
  }

  private async requireRiderWithPrisma(actor: User) {
    if (!actor.roles.includes('RIDER')) throw new ForbiddenError('Rider role required');
    return this.requireRiderByIdWithPrisma(actor.id);
  }

  private async requireRiderByIdWithPrisma(riderId: string) {
    const rider = await this.prisma.riderProfile.findUnique({ where: { userId: riderId } });
    if (!rider) throw new ForbiddenError('Rider profile missing');
    return rider;
  }

  private async systemActorId() {
    const admin = await this.prisma.user.findFirst({
      where: { userRoles: { some: { role: { code: 'OPS_ADMIN' } } } },
    });
    if (admin) return admin.id;
    const system = await this.prisma.user.upsert({
      where: { phone: '+910000000000' },
      update: {},
      create: { phone: '+910000000000', name: 'System', status: 'ACTIVE' },
    });
    return system.id;
  }

  private toAssignment(assignment: {
    id: string;
    deliveryId: string;
    riderId: string;
    status: string;
    offeredAt: Date;
    expiresAt: Date | null;
    acceptedAt: Date | null;
  }): Assignment {
    return {
      id: assignment.id,
      deliveryId: assignment.deliveryId,
      riderId: assignment.riderId,
      status: assignment.status as AssignmentStatus,
      offeredAt: assignment.offeredAt.toISOString(),
      expiresAt: assignment.expiresAt?.toISOString(),
      acceptedAt: assignment.acceptedAt?.toISOString(),
    };
  }

  private toDelivery(delivery: {
    id: string;
    type: string;
    status: string;
    customerId: string | null;
    businessId: string | null;
    quoteId: string;
    pickupAddressId: string;
    dropAddressId: string;
    paymentId: string | null;
    assignedRiderId: string | null;
    idempotencyKey: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: delivery.id,
      type: delivery.type,
      status: delivery.status,
      customerId: delivery.customerId ?? undefined,
      businessId: delivery.businessId ?? undefined,
      quoteId: delivery.quoteId,
      pickupAddressId: delivery.pickupAddressId,
      dropAddressId: delivery.dropAddressId,
      paymentId: delivery.paymentId ?? undefined,
      assignedRiderId: delivery.assignedRiderId ?? undefined,
      idempotencyKey: delivery.idempotencyKey,
      createdAt: delivery.createdAt.toISOString(),
      updatedAt: delivery.updatedAt.toISOString(),
    };
  }

  private isUniqueConstraintError(error: unknown) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
