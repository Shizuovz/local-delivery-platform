import { Injectable } from '@nestjs/common';
import { DeliveryStatus, Proof, RiderAvailabilityStatus, RiderDocument, SignedUpload, User } from '@local-delivery/types';
import { Prisma } from '@local-delivery/database';
import { ForbiddenError, NotFoundError } from '../../common/domain-errors';
import { InMemoryStore } from '../../common/in-memory-store';
import { ObjectStorageService } from '../../common/object-storage.service';
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
    private readonly storage: ObjectStorageService,
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

  documents(actor: User) {
    if (this.prisma.isEnabled()) {
      return this.documentsWithPrisma(actor);
    }

    this.requireRider(actor);
    return [...this.store.riderDocuments.values()]
      .filter((document) => document.riderId === actor.id)
      .map((document) => this.toRiderDocument(document));
  }

  async createDocumentUploadUrl(
    actor: User,
    input: { type: string; fileName: string; contentType: string; expiresAt?: string },
  ): Promise<{ document: RiderDocument; upload: SignedUpload }> {
    if (this.prisma.isEnabled()) {
      return this.createDocumentUploadUrlWithPrisma(actor, input);
    }

    this.requireRider(actor);
    const upload = this.storage.createSignedUpload({
      scope: 'rider-documents',
      ownerId: actor.id,
      fileName: input.fileName,
      contentType: input.contentType,
    });
    const document: RiderDocument = {
      id: this.store.createId('doc'),
      riderId: actor.id,
      type: input.type,
      status: 'PENDING',
      expiresAt: input.expiresAt,
      retentionExpiresAt: this.riderDocumentRetentionExpiresAt().toISOString(),
      createdAt: this.store.now(),
    };
    const storedDocument = { ...document, fileUrl: upload.objectKey };
    this.store.riderDocuments.set(document.id, storedDocument);
    this.store.writeAudit(actor.id, 'rider_document.upload_url.create', 'rider_document', document.id, undefined, {
      type: document.type,
      objectKey: upload.objectKey,
    });
    return { document: this.toRiderDocument(storedDocument), upload };
  }

  async signedDocumentAccess(documentId: string, expires: string, token: string) {
    const expiresAt = Number(expires);
    const path = `/api/v1/rider/documents/${documentId}/file`;
    if (!this.storage.verifyReadUrl(path, documentId, expiresAt, token)) {
      throw new ForbiddenError('Invalid or expired rider document URL');
    }

    if (this.prisma.isEnabled()) {
      const document = await this.prisma.riderDocument.findUnique({ where: { id: documentId } });
      if (!document?.fileUrl) throw new NotFoundError('Rider document file not found');
      return {
        documentId,
        type: document.type,
        storageProvider: 'mock-private',
        fileRef: document.fileUrl,
        expiresAt: new Date(expiresAt).toISOString(),
      };
    }

    const document = this.store.riderDocuments.get(documentId);
    if (!document?.fileUrl) throw new NotFoundError('Rider document file not found');
    return {
      documentId,
      type: document.type,
      storageProvider: 'mock-private',
      fileRef: document.fileUrl,
      expiresAt: new Date(expiresAt).toISOString(),
    };
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
    const delivery = this.store.deliveries.get(deliveryId);
    if (['BUSINESS_DELIVERY', 'LIMITED_FETCH'].includes(String(delivery?.type)) && !pickupReference) {
      throw new ForbiddenError('Pickup proof is required for this delivery type');
    }
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

  delivered(actor: User, assignmentId: string, proof: { otp?: string; photoUrl?: string; signatureUrl?: string; photoObjectKey?: string; signatureObjectKey?: string }) {
    if (this.prisma.isEnabled()) {
      return this.deliveredWithPrisma(actor, assignmentId, proof);
    }

    const deliveryId = this.deliveryIdForAcceptedAssignment(actor, assignmentId);
    if (proof.otp !== '123456' && !proof.photoUrl && !proof.signatureUrl && !proof.photoObjectKey && !proof.signatureObjectKey) {
      throw new ForbiddenError('Delivery proof is required');
    }
    this.createProof(actor, deliveryId, proof.otp === '123456' ? 'OTP' : proof.photoUrl || proof.photoObjectKey ? 'PHOTO' : 'SIGNATURE', proof);
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
      fileUrl: this.proofFileRef(metadata),
      otpVerified: type === 'OTP',
      metadata,
      retentionExpiresAt: this.proofRetentionExpiresAt().toISOString(),
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
    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (['BUSINESS_DELIVERY', 'LIMITED_FETCH'].includes(String(delivery?.type)) && !pickupReference) {
      throw new ForbiddenError('Pickup proof is required for this delivery type');
    }
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

  private async deliveredWithPrisma(actor: User, assignmentId: string, proof: { otp?: string; photoUrl?: string; signatureUrl?: string; photoObjectKey?: string; signatureObjectKey?: string }) {
    const deliveryId = await this.deliveryIdForAcceptedAssignmentWithPrisma(actor, assignmentId);
    if (proof.otp !== '123456' && !proof.photoUrl && !proof.signatureUrl && !proof.photoObjectKey && !proof.signatureObjectKey) {
      throw new ForbiddenError('Delivery proof is required');
    }
    await this.createProofWithPrisma(actor, deliveryId, proof.otp === '123456' ? 'OTP' : proof.photoUrl || proof.photoObjectKey ? 'PHOTO' : 'SIGNATURE', proof);
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
        fileUrl: this.proofFileRef(metadata),
        otpVerified: type === 'OTP',
        metadata: metadata as Prisma.InputJsonObject,
        retentionExpiresAt: this.proofRetentionExpiresAt(),
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

  private proofRetentionExpiresAt() {
    const days = Number(process.env.PROOF_RETENTION_DAYS ?? 90);
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private riderDocumentRetentionExpiresAt() {
    const days = Number(process.env.RIDER_DOCUMENT_RETENTION_DAYS ?? 365);
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private proofFileRef(metadata: Record<string, unknown>) {
    for (const key of ['photoObjectKey', 'signatureObjectKey', 'photoUrl', 'signatureUrl']) {
      const value = metadata[key];
      if (typeof value === 'string') return value;
    }
    return undefined;
  }

  private async documentsWithPrisma(actor: User) {
    await this.requireRiderWithPrisma(actor);
    const documents = await this.prisma.riderDocument.findMany({
      where: { riderId: actor.id },
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

  private async createDocumentUploadUrlWithPrisma(
    actor: User,
    input: { type: string; fileName: string; contentType: string; expiresAt?: string },
  ): Promise<{ document: RiderDocument; upload: SignedUpload }> {
    await this.requireRiderWithPrisma(actor);
    const upload = this.storage.createSignedUpload({
      scope: 'rider-documents',
      ownerId: actor.id,
      fileName: input.fileName,
      contentType: input.contentType,
    });
    const document = await this.prisma.riderDocument.create({
      data: {
        riderId: actor.id,
        type: input.type,
        fileUrl: upload.objectKey,
        status: 'PENDING',
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        retentionExpiresAt: this.riderDocumentRetentionExpiresAt(),
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'rider_document.upload_url.create',
        entityType: 'rider_document',
        entityId: document.id,
        metadata: { type: document.type, objectKey: upload.objectKey },
      },
    });
    return {
      document: this.toRiderDocument({
        id: document.id,
        riderId: document.riderId,
        type: document.type,
        status: document.status as RiderDocument['status'],
        signedUrl: document.fileUrl ?? undefined,
        expiresAt: document.expiresAt?.toISOString(),
        retentionExpiresAt: document.retentionExpiresAt?.toISOString(),
        createdAt: document.createdAt.toISOString(),
      }),
      upload,
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

  private async requireRiderWithPrisma(actor: User) {
    if (!actor.roles.includes('RIDER')) throw new ForbiddenError('Rider role required');
    const rider = await this.prisma.riderProfile.findUnique({ where: { userId: actor.id } });
    if (!rider) throw new ForbiddenError('Rider profile missing');
    return rider;
  }
}
