import { Injectable } from '@nestjs/common';
import { DeliveryStatus, Proof, RiderAvailabilityStatus, User } from '@local-delivery/types';
import { Prisma } from '@local-delivery/database';
import { ForbiddenError, NotFoundError } from '../../common/domain-errors';
import { InMemoryStore } from '../../common/in-memory-store';
import { PrismaService } from '../../common/prisma.service';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { DispatchService } from '../dispatch/dispatch.service';

@Injectable()
export class RidersService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly deliveriesService: DeliveriesService,
    private readonly dispatchService: DispatchService,
    private readonly prisma: PrismaService,
  ) {}

  setAvailability(actor: User, online: boolean) {
    if (this.prisma.isEnabled()) {
      return this.setAvailabilityWithPrisma(actor, online);
    }

    const rider = this.requireRider(actor);
    if (rider.suspended) {
      rider.availabilityStatus = RiderAvailabilityStatus.SUSPENDED;
      throw new ForbiddenError('Suspended riders cannot go online');
    }
    rider.availabilityStatus = online ? RiderAvailabilityStatus.ONLINE_IDLE : RiderAvailabilityStatus.OFFLINE;
    return rider;
  }

  updateLocation(actor: User, lat: number, lng: number) {
    if (this.prisma.isEnabled()) {
      return this.updateLocationWithPrisma(actor, lat, lng);
    }

    this.requireRider(actor);
    const location = { riderId: actor.id, lat, lng, recordedAt: this.store.now() };
    this.store.locations.set(actor.id, location);
    return location;
  }

  offers(actor: User) {
    if (this.prisma.isEnabled()) {
      return this.offersWithPrisma(actor);
    }

    this.requireRider(actor);
    return this.dispatchService.findOffersForRider(actor.id);
  }

  accept(actor: User, assignmentId: string) {
    return this.dispatchService.acceptAssignment(actor, assignmentId);
  }

  reject(actor: User, assignmentId: string) {
    return this.dispatchService.rejectAssignment(actor, assignmentId);
  }

  arrivedPickup(actor: User, assignmentId: string) {
    if (this.prisma.isEnabled()) {
      return this.arrivedPickupWithPrisma(actor, assignmentId);
    }

    const deliveryId = this.deliveryIdForAcceptedAssignment(actor, assignmentId);
    return this.deliveriesService.transition(deliveryId, DeliveryStatus.EN_ROUTE_PICKUP, actor.id, 'Rider heading to pickup');
  }

  pickedUp(actor: User, assignmentId: string, pickupReference?: string) {
    if (this.prisma.isEnabled()) {
      return this.pickedUpWithPrisma(actor, assignmentId, pickupReference);
    }

    const deliveryId = this.deliveryIdForAcceptedAssignment(actor, assignmentId);
    this.deliveriesService.transition(deliveryId, DeliveryStatus.ARRIVED_PICKUP, actor.id, 'Rider arrived pickup');
    if (pickupReference) {
      this.createProof(actor, deliveryId, 'PICKUP_REFERENCE', { pickupReference });
    }
    return this.deliveriesService.transition(deliveryId, DeliveryStatus.PICKED_UP, actor.id, 'Pickup verified');
  }

  arrivedDrop(actor: User, assignmentId: string) {
    if (this.prisma.isEnabled()) {
      return this.arrivedDropWithPrisma(actor, assignmentId);
    }

    const deliveryId = this.deliveryIdForAcceptedAssignment(actor, assignmentId);
    this.deliveriesService.transition(deliveryId, DeliveryStatus.EN_ROUTE_DROP, actor.id, 'Rider heading to drop');
    return this.deliveriesService.transition(deliveryId, DeliveryStatus.ARRIVED_DROP, actor.id, 'Rider arrived drop');
  }

  delivered(actor: User, assignmentId: string, proof: { otp?: string; photoUrl?: string; signatureUrl?: string }) {
    if (this.prisma.isEnabled()) {
      return this.deliveredWithPrisma(actor, assignmentId, proof);
    }

    const deliveryId = this.deliveryIdForAcceptedAssignment(actor, assignmentId);
    if (proof.otp !== '123456' && !proof.photoUrl && !proof.signatureUrl) {
      throw new ForbiddenError('Delivery proof is required');
    }
    this.createProof(actor, deliveryId, proof.otp === '123456' ? 'OTP' : proof.photoUrl ? 'PHOTO' : 'SIGNATURE', proof);
    const delivery = this.deliveriesService.transition(deliveryId, DeliveryStatus.DELIVERED, actor.id, 'Delivery proof verified');
    const rider = this.store.riders.get(actor.id);
    if (rider) rider.availabilityStatus = RiderAvailabilityStatus.ONLINE_IDLE;
    return delivery;
  }

  earnings(actor: User) {
    if (this.prisma.isEnabled()) {
      return this.earningsWithPrisma(actor);
    }

    this.requireRider(actor);
    return [...this.store.deliveries.values()]
      .filter((delivery) => delivery.assignedRiderId === actor.id && delivery.status === DeliveryStatus.DELIVERED)
      .map((delivery) => ({ deliveryId: delivery.id, amountMinor: 2500, currency: 'INR', status: 'READY' }));
  }

  private deliveryIdForAcceptedAssignment(actor: User, assignmentId: string) {
    this.requireRider(actor);
    const assignment = this.store.assignments.get(assignmentId);
    if (!assignment) throw new NotFoundError('Assignment not found');
    if (assignment.riderId !== actor.id) throw new ForbiddenError('Assignment is not owned by this rider');
    if (assignment.status !== 'ACCEPTED') throw new ForbiddenError('Assignment is not accepted by this rider');
    return assignment.deliveryId;
  }

  private createProof(actor: User, deliveryId: string, type: Proof['type'], metadata: Record<string, unknown>) {
    const proof: Proof = {
      id: this.store.createId('proof'),
      deliveryId,
      type,
      createdBy: actor.id,
      fileUrl: typeof metadata.photoUrl === 'string' ? metadata.photoUrl : typeof metadata.signatureUrl === 'string' ? metadata.signatureUrl : undefined,
      otpVerified: type === 'OTP',
      metadata,
      createdAt: this.store.now(),
    };
    this.store.proofs.set(proof.id, proof);
    this.store.writeAudit(actor.id, 'proof.create', 'delivery', deliveryId, undefined, { type });
    return proof;
  }

  private requireRider(actor: User) {
    if (!actor.roles.includes('RIDER')) throw new ForbiddenError('Rider role required');
    const rider = this.store.riders.get(actor.id);
    if (!rider) throw new ForbiddenError('Rider profile missing');
    return rider;
  }

  private async setAvailabilityWithPrisma(actor: User, online: boolean) {
    const rider = await this.requireRiderWithPrisma(actor);
    if (rider.suspended) {
      await this.prisma.riderProfile.update({
        where: { userId: actor.id },
        data: { availabilityStatus: 'SUSPENDED' },
      });
      throw new ForbiddenError('Suspended riders cannot go online');
    }
    return this.prisma.riderProfile.update({
      where: { userId: actor.id },
      data: { availabilityStatus: online ? 'ONLINE_IDLE' : 'OFFLINE' },
    });
  }

  private async updateLocationWithPrisma(actor: User, lat: number, lng: number) {
    await this.requireRiderWithPrisma(actor);
    const location = await this.prisma.riderLocation.create({
      data: { riderId: actor.id, lat, lng },
    });
    return {
      riderId: location.riderId,
      lat: Number(location.lat),
      lng: Number(location.lng),
      recordedAt: location.recordedAt.toISOString(),
    };
  }

  private async arrivedPickupWithPrisma(actor: User, assignmentId: string) {
    const deliveryId = await this.deliveryIdForAcceptedAssignmentWithPrisma(actor, assignmentId);
    return this.deliveriesService.transition(deliveryId, DeliveryStatus.EN_ROUTE_PICKUP, actor.id, 'Rider heading to pickup');
  }

  private async pickedUpWithPrisma(actor: User, assignmentId: string, pickupReference?: string) {
    const deliveryId = await this.deliveryIdForAcceptedAssignmentWithPrisma(actor, assignmentId);
    await this.deliveriesService.transition(deliveryId, DeliveryStatus.ARRIVED_PICKUP, actor.id, 'Rider arrived pickup');
    if (pickupReference) {
      await this.createProofWithPrisma(actor, deliveryId, 'PICKUP_REFERENCE', { pickupReference });
    }
    return this.deliveriesService.transition(deliveryId, DeliveryStatus.PICKED_UP, actor.id, 'Pickup verified');
  }

  private async arrivedDropWithPrisma(actor: User, assignmentId: string) {
    const deliveryId = await this.deliveryIdForAcceptedAssignmentWithPrisma(actor, assignmentId);
    await this.deliveriesService.transition(deliveryId, DeliveryStatus.EN_ROUTE_DROP, actor.id, 'Rider heading to drop');
    return this.deliveriesService.transition(deliveryId, DeliveryStatus.ARRIVED_DROP, actor.id, 'Rider arrived drop');
  }

  private async deliveredWithPrisma(actor: User, assignmentId: string, proof: { otp?: string; photoUrl?: string; signatureUrl?: string }) {
    const deliveryId = await this.deliveryIdForAcceptedAssignmentWithPrisma(actor, assignmentId);
    if (proof.otp !== '123456' && !proof.photoUrl && !proof.signatureUrl) {
      throw new ForbiddenError('Delivery proof is required');
    }
    await this.createProofWithPrisma(actor, deliveryId, proof.otp === '123456' ? 'OTP' : proof.photoUrl ? 'PHOTO' : 'SIGNATURE', proof);
    const delivery = await this.deliveriesService.transition(deliveryId, DeliveryStatus.DELIVERED, actor.id, 'Delivery proof verified');
    await this.prisma.riderProfile.update({
      where: { userId: actor.id },
      data: { availabilityStatus: 'ONLINE_IDLE' },
    });
    await this.prisma.riderEarning.create({
      data: {
        deliveryId,
        riderId: actor.id,
        amountMinor: 2500,
        currency: 'INR',
        status: 'READY',
      },
    }).catch(() => undefined);
    return delivery;
  }

  private async earningsWithPrisma(actor: User) {
    await this.requireRiderWithPrisma(actor);
    return this.prisma.riderEarning.findMany({
      where: { riderId: actor.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async offersWithPrisma(actor: User) {
    await this.requireRiderWithPrisma(actor);
    return this.dispatchService.findOffersForRider(actor.id);
  }

  private async deliveryIdForAcceptedAssignmentWithPrisma(actor: User, assignmentId: string) {
    await this.requireRiderWithPrisma(actor);
    const assignment = await this.prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) throw new NotFoundError('Assignment not found');
    if (assignment.riderId !== actor.id) throw new ForbiddenError('Assignment is not owned by this rider');
    if (assignment.status !== 'ACCEPTED') throw new ForbiddenError('Assignment is not accepted by this rider');
    return assignment.deliveryId;
  }

  private async createProofWithPrisma(actor: User, deliveryId: string, type: Proof['type'], metadata: Record<string, unknown>) {
    const proof = await this.prisma.proof.create({
      data: {
        deliveryId,
        type,
        createdBy: actor.id,
        fileUrl: typeof metadata.photoUrl === 'string' ? metadata.photoUrl : typeof metadata.signatureUrl === 'string' ? metadata.signatureUrl : undefined,
        otpVerified: type === 'OTP',
        metadata: metadata as Prisma.InputJsonObject,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'proof.create',
        entityType: 'delivery',
        entityId: deliveryId,
        metadata: { type, proofId: proof.id },
      },
    });
    return proof;
  }

  private async requireRiderWithPrisma(actor: User) {
    if (!actor.roles.includes('RIDER')) throw new ForbiddenError('Rider role required');
    const rider = await this.prisma.riderProfile.findUnique({ where: { userId: actor.id } });
    if (!rider) throw new ForbiddenError('Rider profile missing');
    return rider;
  }
}
