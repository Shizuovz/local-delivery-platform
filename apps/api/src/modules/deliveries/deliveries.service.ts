import { Injectable } from '@nestjs/common';
import {
  Prisma,
} from '@local-delivery/database';
import {
  AssignmentStatus,
  Delivery,
  DeliveryItem,
  DeliveryQuote,
  DeliveryStatus,
  DeliveryType,
  PaymentStatus,
  Payment,
  Refund,
  RefundStatus,
  TERMINAL_DELIVERY_STATUSES,
  User,
} from '@local-delivery/types';
import { ConflictError, ForbiddenError, NotFoundError } from '../../common/domain-errors';
import { InMemoryStore } from '../../common/in-memory-store';
import { PrismaService } from '../../common/prisma.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { CreateDeliveryDto, CreateQuoteDto } from './deliveries.dto';

interface CreatedDeliveryResult {
  delivery: Delivery;
  payment: Payment;
}

const ALLOWED_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  [DeliveryStatus.DRAFT]: [DeliveryStatus.QUOTED, DeliveryStatus.CONFIRMED, DeliveryStatus.CANCELLED],
  [DeliveryStatus.QUOTED]: [DeliveryStatus.CONFIRMED, DeliveryStatus.CANCELLED],
  [DeliveryStatus.CONFIRMED]: [DeliveryStatus.SEARCHING_RIDER, DeliveryStatus.CANCELLED],
  [DeliveryStatus.SEARCHING_RIDER]: [DeliveryStatus.RIDER_ASSIGNED, DeliveryStatus.CANCELLED, DeliveryStatus.FAILED],
  [DeliveryStatus.RIDER_ASSIGNED]: [DeliveryStatus.EN_ROUTE_PICKUP, DeliveryStatus.CANCELLED],
  [DeliveryStatus.EN_ROUTE_PICKUP]: [DeliveryStatus.ARRIVED_PICKUP, DeliveryStatus.CANCELLED],
  [DeliveryStatus.ARRIVED_PICKUP]: [DeliveryStatus.PICKED_UP, DeliveryStatus.CANCELLED],
  [DeliveryStatus.PICKED_UP]: [DeliveryStatus.EN_ROUTE_DROP, DeliveryStatus.RETURN_REQUIRED, DeliveryStatus.DISPUTED],
  [DeliveryStatus.EN_ROUTE_DROP]: [DeliveryStatus.ARRIVED_DROP, DeliveryStatus.RETURN_REQUIRED, DeliveryStatus.DISPUTED],
  [DeliveryStatus.ARRIVED_DROP]: [DeliveryStatus.DELIVERED, DeliveryStatus.RETURN_REQUIRED, DeliveryStatus.DISPUTED],
  [DeliveryStatus.DELIVERED]: [],
  [DeliveryStatus.CANCELLED]: [],
  [DeliveryStatus.FAILED]: [],
  [DeliveryStatus.RETURN_REQUIRED]: [DeliveryStatus.RETURNED, DeliveryStatus.DISPUTED],
  [DeliveryStatus.RETURNED]: [],
  [DeliveryStatus.DISPUTED]: [DeliveryStatus.RETURN_REQUIRED, DeliveryStatus.FAILED],
};

@Injectable()
export class DeliveriesService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly dispatchService: DispatchService,
    private readonly prisma: PrismaService,
  ) {}

  createQuote(actor: User, input: CreateQuoteDto): DeliveryQuote | Promise<DeliveryQuote> {
    if (!['SEND', 'LIMITED_FETCH'].includes(input.type)) {
      throw new ForbiddenError('Only SEND and LIMITED_FETCH are enabled for customer deliveries');
    }
    this.assertLimitedFetchPolicy(input);

    if (this.prisma?.isEnabled()) {
      return this.createQuoteWithPrisma(actor, input);
    }

    const pickup = {
      id: this.store.createId('addr'),
      ...input.pickupAddress,
    };
    const drop = {
      id: this.store.createId('addr'),
      ...input.dropAddress,
    };
    const distanceMeters = Math.max(1000, this.distanceMeters(pickup.lat, pickup.lng, drop.lat, drop.lng));
    const baseFeeMinor = 3000;
    const distanceFeeMinor = Math.ceil(distanceMeters / 1000) * 1000;
    const packageFeeMinor = input.item.packageClass === 'LARGE' ? 5000 : input.item.packageClass === 'MEDIUM' ? 2000 : 0;
    const platformFeeMinor = 500;
    const taxMinor = 0;
    const discountMinor = 0;
    const amountMinor = baseFeeMinor + distanceFeeMinor + packageFeeMinor + platformFeeMinor + taxMinor - discountMinor;

    const quote: DeliveryQuote = {
      id: this.store.createId('quote'),
      customerId: actor.id,
      type: input.type === 'LIMITED_FETCH' ? DeliveryType.LIMITED_FETCH : DeliveryType.SEND,
      pickupAddressId: pickup.id,
      dropAddressId: drop.id,
      distanceMeters,
      amountMinor,
      currency: 'INR',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      pricing: {
        baseFeeMinor,
        distanceFeeMinor,
        packageFeeMinor,
        zoneSurchargeMinor: 0,
        platformFeeMinor,
        taxMinor,
        discountMinor,
      },
    };

    this.store.quotes.set(quote.id, quote);
    this.store.deliveryItems.set(quote.id, {
      id: this.store.createId('item'),
      deliveryId: quote.id,
      ...this.itemWithLimitedFetchNotes(input),
    });

    return quote;
  }

  createDelivery(actor: User, input: CreateDeliveryDto): CreatedDeliveryResult | Promise<CreatedDeliveryResult> {
    if (this.prisma?.isEnabled()) {
      return this.createDeliveryWithPrisma(actor, input);
    }

    const idempotencyScope = `${actor.id}:delivery:create:${input.idempotencyKey}`;
    const existingDeliveryId = this.store.deliveryIdempotency.get(idempotencyScope);
    if (existingDeliveryId) {
      const detail = this.getDeliveryForActorFromMemory(actor, existingDeliveryId);
      if (!detail.payment) {
        throw new ConflictError('Existing delivery is missing payment record');
      }
      return { delivery: detail.delivery, payment: detail.payment };
    }

    const quote = this.store.quotes.get(input.quoteId);
    if (!quote) throw new NotFoundError('Quote not found');
    if (quote.customerId !== actor.id) throw new ForbiddenError('Quote does not belong to current user');
    if (Date.parse(quote.expiresAt) < Date.now()) throw new ConflictError('Quote expired');

    const now = this.store.now();
    const delivery: Delivery = {
      id: this.store.createId('del'),
      type: quote.type,
      status: DeliveryStatus.CONFIRMED,
      customerId: actor.id,
      quoteId: quote.id,
      pickupAddressId: quote.pickupAddressId,
      dropAddressId: quote.dropAddressId,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
      updatedAt: now,
    };

    const payment = {
      id: this.store.createId('pay'),
      deliveryId: delivery.id,
      provider: 'mock' as const,
      providerRef: `mock_${delivery.id}`,
      amountMinor: quote.amountMinor,
      currency: quote.currency,
      status: PaymentStatus.PENDING,
    };
    delivery.paymentId = payment.id;

    const quoteItem = this.store.deliveryItems.get(quote.id);
    if (quoteItem) {
      const deliveryItem: DeliveryItem = { ...quoteItem, id: this.store.createId('item'), deliveryId: delivery.id };
      this.store.deliveryItems.set(deliveryItem.id, deliveryItem);
    }

    this.store.deliveries.set(delivery.id, delivery);
    this.store.payments.set(payment.id, payment);
    this.store.deliveryIdempotency.set(idempotencyScope, delivery.id);
    this.store.writeHistory(delivery.id, DeliveryStatus.CONFIRMED, actor.id, `${delivery.type} delivery created from quote`);
    this.store.writeAudit(actor.id, 'delivery.create', 'delivery', delivery.id, undefined, { type: delivery.type });

    return { delivery, payment };
  }

  listForActor(actor: User) {
    if (this.prisma?.isEnabled()) {
      return this.listForActorWithPrisma(actor);
    }

    if (actor.roles.includes('OPS_ADMIN') || actor.roles.includes('SUPER_ADMIN')) {
      return [...this.store.deliveries.values()];
    }
    return [...this.store.deliveries.values()].filter((delivery) => delivery.customerId === actor.id);
  }

  getDeliveryForActor(actor: User, deliveryId: string) {
    if (this.prisma?.isEnabled()) {
      return this.getDeliveryForActorWithPrisma(actor, deliveryId);
    }

    return this.getDeliveryForActorFromMemory(actor, deliveryId);
  }

  private getDeliveryForActorFromMemory(actor: User, deliveryId: string) {
    const delivery = this.getDelivery(deliveryId);
    if (actor.roles.includes('OPS_ADMIN') || actor.roles.includes('SUPER_ADMIN') || delivery.customerId === actor.id || delivery.assignedRiderId === actor.id) {
      return {
        delivery,
        quote: this.store.quotes.get(delivery.quoteId),
        payment: delivery.paymentId ? this.store.payments.get(delivery.paymentId) : undefined,
        assignments: [...this.store.assignments.values()].filter((assignment) => assignment.deliveryId === delivery.id),
        proofs: [...this.store.proofs.values()].filter((proof) => proof.deliveryId === delivery.id),
        history: this.store.history.filter((event) => event.deliveryId === delivery.id),
      };
    }
    throw new ForbiddenError('You cannot access this delivery');
  }

  transition(deliveryId: string, next: DeliveryStatus, actorId: string, reason?: string) {
    if (this.prisma?.isEnabled()) {
      return this.transitionWithPrisma(deliveryId, next, actorId, reason);
    }

    const delivery = this.getDelivery(deliveryId);
    if (TERMINAL_DELIVERY_STATUSES.has(delivery.status)) {
      throw new ConflictError(`Delivery is terminal: ${delivery.status}`);
    }
    if (!ALLOWED_TRANSITIONS[delivery.status].includes(next)) {
      throw new ConflictError(`Cannot transition delivery from ${delivery.status} to ${next}`);
    }
    delivery.status = next;
    delivery.updatedAt = this.store.now();
    this.store.writeHistory(delivery.id, next, actorId, reason);
    return delivery;
  }

  cancel(actor: User, deliveryId: string, reason: string) {
    if (this.prisma?.isEnabled()) {
      return this.cancelWithPrisma(actor, deliveryId, reason);
    }

    const detail = this.getDeliveryForActorFromMemory(actor, deliveryId);
    const delivery = detail.delivery;
    if (delivery.status === DeliveryStatus.PICKED_UP || delivery.status === DeliveryStatus.EN_ROUTE_DROP || delivery.status === DeliveryStatus.ARRIVED_DROP) {
      return this.transition(delivery.id, DeliveryStatus.RETURN_REQUIRED, actor.id, reason);
    }
    const openAssignments = [...this.store.assignments.values()].filter((assignment) => assignment.deliveryId === delivery.id && [AssignmentStatus.OFFERED, AssignmentStatus.ACCEPTED].includes(assignment.status));
    for (const assignment of openAssignments) {
      assignment.status = AssignmentStatus.CANCELLED;
    }
    this.store.writeAudit(actor.id, 'delivery.cancel', 'delivery', delivery.id, reason);
    const cancelled = this.transition(delivery.id, DeliveryStatus.CANCELLED, actor.id, reason);
    this.reconcileCancellationPaymentFromMemory(actor, detail.payment, delivery.id, reason);
    return cancelled;
  }

  async trackingForActor(actor: User, deliveryId: string) {
    if (!this.prisma?.isEnabled()) {
      const detail = this.getDeliveryForActorFromMemory(actor, deliveryId);
      return {
        deliveryId,
        status: detail.delivery.status,
        riderId: detail.delivery.assignedRiderId,
        riderLocation: detail.delivery.assignedRiderId ? this.store.locations.get(detail.delivery.assignedRiderId) : undefined,
      };
    }

    const detail = await this.getDeliveryForActorWithPrisma(actor, deliveryId);
    const riderLocation = detail.delivery.assignedRiderId
      ? await this.prisma.riderLocation.findFirst({
          where: { riderId: detail.delivery.assignedRiderId },
          orderBy: { recordedAt: 'desc' },
        })
      : null;
    return {
      deliveryId,
      status: detail.delivery.status,
      riderId: detail.delivery.assignedRiderId,
      riderLocation: riderLocation
        ? {
            riderId: riderLocation.riderId,
            lat: Number(riderLocation.lat),
            lng: Number(riderLocation.lng),
            recordedAt: riderLocation.recordedAt.toISOString(),
          }
        : undefined,
    };
  }

  private async createQuoteWithPrisma(actor: User, input: CreateQuoteDto): Promise<DeliveryQuote> {
    this.assertLimitedFetchPolicy(input);
    const distanceMeters = Math.max(
      1000,
      this.distanceMeters(input.pickupAddress.lat, input.pickupAddress.lng, input.dropAddress.lat, input.dropAddress.lng),
    );
    const baseFeeMinor = 3000;
    const distanceFeeMinor = Math.ceil(distanceMeters / 1000) * 1000;
    const packageFeeMinor = input.item.packageClass === 'LARGE' ? 5000 : input.item.packageClass === 'MEDIUM' ? 2000 : 0;
    const platformFeeMinor = 500;
    const taxMinor = 0;
    const discountMinor = 0;
    const amountMinor = baseFeeMinor + distanceFeeMinor + packageFeeMinor + platformFeeMinor + taxMinor - discountMinor;

    const quote = await this.prisma.$transaction(async (tx) => {
      const pickup = await tx.address.create({
        data: {
          label: input.pickupAddress.label,
          line1: input.pickupAddress.line1,
          city: input.pickupAddress.city,
          lat: input.pickupAddress.lat,
          lng: input.pickupAddress.lng,
        },
      });
      const drop = await tx.address.create({
        data: {
          label: input.dropAddress.label,
          line1: input.dropAddress.line1,
          city: input.dropAddress.city,
          lat: input.dropAddress.lat,
          lng: input.dropAddress.lng,
        },
      });
      return tx.deliveryQuote.create({
        data: {
          type: input.type,
          customerId: actor.id,
          pickupAddressId: pickup.id,
          dropAddressId: drop.id,
          distanceMeters,
          amountMinor,
          currency: 'INR',
          baseFeeMinor,
          distanceFeeMinor,
          packageFeeMinor,
          zoneSurchargeMinor: 0,
          platformFeeMinor,
          taxMinor,
          discountMinor,
          metadata: this.quoteMetadata(input) as Prisma.InputJsonObject,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });
    });

    await this.prisma.idempotencyKey.create({
      data: {
        actorId: actor.id,
        action: 'delivery.quote.create',
        key: quote.id,
        entityType: 'delivery_quote',
        entityId: quote.id,
        expiresAt: quote.expiresAt,
      },
    }).catch(() => undefined);

    return this.toQuote(quote);
  }

  private async createDeliveryWithPrisma(actor: User, input: CreateDeliveryDto): Promise<CreatedDeliveryResult> {
    const existing = await this.prisma.delivery.findFirst({
      where: { customerId: actor.id, idempotencyKey: input.idempotencyKey },
      include: { payments: true },
    });
    if (existing) {
      const payment = existing.payments[0];
      if (!payment) throw new ConflictError('Existing delivery is missing payment record');
      return { delivery: this.toDelivery(existing, payment.id), payment: this.toPayment(payment) };
    }

    const quote = await this.prisma.deliveryQuote.findUnique({ where: { id: input.quoteId } });
    if (!quote) throw new NotFoundError('Quote not found');
    if (quote.customerId !== actor.id) throw new ForbiddenError('Quote does not belong to current user');
    if (quote.expiresAt.getTime() < Date.now()) throw new ConflictError('Quote expired');
    if (quote.confirmedAt) throw new ConflictError('Quote already confirmed');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const delivery = await tx.delivery.create({
          data: {
            type: quote.type,
            status: 'CONFIRMED',
            customerId: actor.id,
            quoteId: quote.id,
            pickupAddressId: quote.pickupAddressId,
            dropAddressId: quote.dropAddressId,
            idempotencyKey: input.idempotencyKey,
          },
        });
        const payment = await tx.payment.create({
          data: {
            deliveryId: delivery.id,
            provider: 'mock',
            providerRef: `mock_${delivery.id}`,
            amountMinor: quote.amountMinor,
            currency: quote.currency,
            status: 'PENDING',
          },
        });
        const updatedDelivery = await tx.delivery.update({
          where: { id: delivery.id },
          data: { paymentId: payment.id },
        });
        await tx.deliveryQuote.update({
          where: { id: quote.id },
          data: { confirmedAt: new Date() },
        });
        await tx.deliveryStatusHistory.create({
          data: {
            deliveryId: delivery.id,
            status: 'CONFIRMED',
            actorId: actor.id,
            reason: `${quote.type} delivery created from quote`,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: 'delivery.create',
            entityType: 'delivery',
            entityId: delivery.id,
            metadata: { type: quote.type },
          },
        });
        await tx.idempotencyKey.create({
          data: {
            actorId: actor.id,
            action: 'delivery.create',
            key: input.idempotencyKey,
            entityType: 'delivery',
            entityId: delivery.id,
          },
        });

        return { delivery: this.toDelivery(updatedDelivery, payment.id), payment: this.toPayment(payment) };
      });
    } catch (error) {
      const duplicate = await this.prisma.delivery.findFirst({
        where: { customerId: actor.id, idempotencyKey: input.idempotencyKey },
        include: { payments: true },
      });
      if (duplicate?.payments[0]) {
        return { delivery: this.toDelivery(duplicate, duplicate.payments[0].id), payment: this.toPayment(duplicate.payments[0]) };
      }
      throw error;
    }
  }

  private async listForActorWithPrisma(actor: User) {
    const where = actor.roles.includes('OPS_ADMIN') || actor.roles.includes('SUPER_ADMIN')
      ? {}
      : { customerId: actor.id };
    const deliveries = await this.prisma.delivery.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { payments: true },
    });
    return deliveries.map((delivery) => this.toDelivery(delivery, delivery.payments[0]?.id ?? delivery.paymentId ?? undefined));
  }

  private async getDeliveryForActorWithPrisma(actor: User, deliveryId: string) {
    const detail = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: {
        quote: true,
        payments: { include: { refunds: true } },
        assignments: true,
        proofs: true,
        history: { orderBy: { timestamp: 'asc' } },
      },
    });
    if (!detail) throw new NotFoundError('Delivery not found');
    if (
      !actor.roles.includes('OPS_ADMIN')
      && !actor.roles.includes('SUPER_ADMIN')
      && detail.customerId !== actor.id
      && detail.assignedRiderId !== actor.id
    ) {
      throw new ForbiddenError('You cannot access this delivery');
    }

    const payment = detail.payments[0];
    return {
      delivery: this.toDelivery(detail, payment?.id ?? detail.paymentId ?? undefined),
      quote: this.toQuote(detail.quote),
      payment: payment ? this.toPayment(payment) : undefined,
      assignments: detail.assignments.map((assignment) => ({
        id: assignment.id,
        deliveryId: assignment.deliveryId,
        riderId: assignment.riderId,
        status: assignment.status as AssignmentStatus,
        offeredAt: assignment.offeredAt.toISOString(),
        expiresAt: assignment.expiresAt?.toISOString(),
        acceptedAt: assignment.acceptedAt?.toISOString(),
      })),
      proofs: detail.proofs.map((proof) => ({
        id: proof.id,
        deliveryId: proof.deliveryId,
        type: proof.type,
        createdBy: proof.createdBy,
        fileUrl: proof.fileUrl ?? undefined,
        otpVerified: proof.otpVerified,
        metadata: proof.metadata as Record<string, unknown> | undefined,
        createdAt: proof.createdAt.toISOString(),
      })),
      history: detail.history.map((event) => ({
        id: event.id,
        deliveryId: event.deliveryId,
        status: event.status as DeliveryStatus,
        actorId: event.actorId ?? undefined,
        reason: event.reason ?? undefined,
        metadata: event.metadata as Record<string, unknown> | undefined,
        timestamp: event.timestamp.toISOString(),
      })),
    };
  }

  private async transitionWithPrisma(deliveryId: string, next: DeliveryStatus, actorId: string, reason?: string): Promise<Delivery> {
    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) throw new NotFoundError('Delivery not found');
    if (TERMINAL_DELIVERY_STATUSES.has(delivery.status as DeliveryStatus)) {
      throw new ConflictError(`Delivery is terminal: ${delivery.status}`);
    }
    if (!ALLOWED_TRANSITIONS[delivery.status as DeliveryStatus].includes(next)) {
      throw new ConflictError(`Cannot transition delivery from ${delivery.status} to ${next}`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const nextDelivery = await tx.delivery.update({
        where: { id: deliveryId },
        data: { status: next },
      });
      await tx.deliveryStatusHistory.create({
        data: { deliveryId, status: next, actorId, reason },
      });
      return nextDelivery;
    });
    return this.toDelivery(updated, updated.paymentId ?? undefined);
  }

  private async cancelWithPrisma(actor: User, deliveryId: string, reason: string) {
    const detail = await this.getDeliveryForActorWithPrisma(actor, deliveryId);
    const delivery = detail.delivery;
    if ([DeliveryStatus.PICKED_UP, DeliveryStatus.EN_ROUTE_DROP, DeliveryStatus.ARRIVED_DROP].includes(delivery.status)) {
      return this.transitionWithPrisma(delivery.id, DeliveryStatus.RETURN_REQUIRED, actor.id, reason);
    }

    await this.prisma.assignment.updateMany({
      where: { deliveryId: delivery.id, status: { in: ['OFFERED', 'ACCEPTED'] } },
      data: { status: 'CANCELLED' },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'delivery.cancel',
        entityType: 'delivery',
        entityId: delivery.id,
        reason,
      },
    });
    const cancelled = await this.transitionWithPrisma(delivery.id, DeliveryStatus.CANCELLED, actor.id, reason);
    await this.reconcileCancellationPaymentWithPrisma(actor, detail.payment, delivery.id, reason);
    return cancelled;
  }

  private reconcileCancellationPaymentFromMemory(actor: User, payment: Payment | undefined, deliveryId: string, reason: string) {
    if (!payment) return;
    if (payment.status === PaymentStatus.PENDING || payment.status === PaymentStatus.CREATED) {
      payment.status = PaymentStatus.FAILED;
      this.store.writeAudit(actor.id, 'payment.cancel_unpaid', 'payment', payment.id, reason, { deliveryId });
      return;
    }
    if (payment.status !== PaymentStatus.PAID) return;

    const idempotencyKey = `delivery-cancel:${deliveryId}:full-refund`;
    const existingRefundId = this.store.refundIdempotency.get(idempotencyKey);
    if (existingRefundId) {
      return;
    }

    const refund: Refund = {
      id: this.store.createId('refund'),
      paymentId: payment.id,
      amountMinor: payment.amountMinor,
      status: RefundStatus.SUCCEEDED,
      reason,
      idempotencyKey,
      providerRefundRef: `mock_refund_${payment.id}`,
      requestedBy: actor.id,
      processedAt: this.store.now(),
    };
    this.store.refunds.set(refund.id, refund);
    this.store.refundIdempotency.set(idempotencyKey, refund.id);
    payment.status = PaymentStatus.REFUNDED;
    this.store.writeAudit(actor.id, 'refund.mock_succeeded', 'refund', refund.id, reason, {
      deliveryId,
      paymentId: payment.id,
      amountMinor: refund.amountMinor,
    });
  }

  private async reconcileCancellationPaymentWithPrisma(actor: User, payment: Payment | undefined, deliveryId: string, reason: string) {
    if (!payment) return;
    if (payment.status === PaymentStatus.PENDING || payment.status === PaymentStatus.CREATED) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED' },
      });
      await this.prisma.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'payment.cancel_unpaid',
          entityType: 'payment',
          entityId: payment.id,
          reason,
          metadata: { deliveryId },
        },
      });
      return;
    }
    if (payment.status !== PaymentStatus.PAID) return;

    const idempotencyKey = `delivery-cancel:${deliveryId}:full-refund`;
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.refund.findUnique({ where: { idempotencyKey } });
      if (existing) return;

      const refund = await tx.refund.create({
        data: {
          paymentId: payment.id,
          amountMinor: payment.amountMinor,
          status: 'SUCCEEDED',
          reason,
          idempotencyKey,
          providerRefundRef: `mock_refund_${payment.id}`,
          requestedBy: actor.id,
          processedAt: new Date(),
        },
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'REFUNDED' },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'refund.mock_succeeded',
          entityType: 'refund',
          entityId: refund.id,
          reason,
          metadata: {
            deliveryId,
            paymentId: payment.id,
            amountMinor: refund.amountMinor,
          },
        },
      });
    });
  }

  private getDelivery(deliveryId: string) {
    const delivery = this.store.deliveries.get(deliveryId);
    if (!delivery) throw new NotFoundError('Delivery not found');
    return delivery;
  }

  private assertLimitedFetchPolicy(input: CreateQuoteDto) {
    if (input.type !== 'LIMITED_FETCH') return;
    if (!input.pickupReference || !input.pickupInstructions || input.itemAlreadyPaid !== true) {
      throw new ForbiddenError('LIMITED_FETCH requires known pickup reference, pickup instructions, and already-paid confirmation');
    }
  }

  private itemWithLimitedFetchNotes(input: CreateQuoteDto) {
    if (input.type !== 'LIMITED_FETCH') return input.item;
    return {
      ...input.item,
      notes: [
        input.item.notes,
        `Pickup reference: ${input.pickupReference}`,
        `Pickup instructions: ${input.pickupInstructions}`,
        'Customer confirmed item is already paid or no payment is needed.',
      ].filter(Boolean).join('\n'),
    };
  }

  private quoteMetadata(input: CreateQuoteDto) {
    if (input.type !== 'LIMITED_FETCH') {
      return { item: input.item };
    }
    return {
      item: input.item,
      limitedFetch: {
        pickupReference: input.pickupReference,
        pickupInstructions: input.pickupInstructions,
        itemAlreadyPaid: input.itemAlreadyPaid,
        riderPaymentAllowed: false,
        substitutionAllowed: false,
      },
    };
  }

  private distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
    const kmPerDegree = 111;
    const x = (lng2 - lng1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
    const y = lat2 - lat1;
    return Math.round(Math.sqrt(x * x + y * y) * kmPerDegree * 1000);
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
  }, paymentId?: string): Delivery {
    return {
      id: delivery.id,
      type: delivery.type as DeliveryType,
      status: delivery.status as DeliveryStatus,
      customerId: delivery.customerId ?? undefined,
      businessId: delivery.businessId ?? undefined,
      quoteId: delivery.quoteId,
      pickupAddressId: delivery.pickupAddressId,
      dropAddressId: delivery.dropAddressId,
      paymentId: paymentId ?? delivery.paymentId ?? undefined,
      assignedRiderId: delivery.assignedRiderId ?? undefined,
      idempotencyKey: delivery.idempotencyKey,
      createdAt: delivery.createdAt.toISOString(),
      updatedAt: delivery.updatedAt.toISOString(),
    };
  }

  private toQuote(quote: {
    id: string;
    type: string;
    customerId: string | null;
    businessId: string | null;
    pickupAddressId: string;
    dropAddressId: string;
    distanceMeters: number;
    amountMinor: number;
    currency: string;
    expiresAt: Date;
    baseFeeMinor: number;
    distanceFeeMinor: number;
    packageFeeMinor: number;
    zoneSurchargeMinor: number;
    platformFeeMinor: number;
    taxMinor: number;
    discountMinor: number;
  }): DeliveryQuote {
    return {
      id: quote.id,
      type: quote.type as DeliveryType,
      customerId: quote.customerId ?? undefined,
      businessId: quote.businessId ?? undefined,
      pickupAddressId: quote.pickupAddressId,
      dropAddressId: quote.dropAddressId,
      distanceMeters: quote.distanceMeters,
      amountMinor: quote.amountMinor,
      currency: quote.currency,
      expiresAt: quote.expiresAt.toISOString(),
      pricing: {
        baseFeeMinor: quote.baseFeeMinor,
        distanceFeeMinor: quote.distanceFeeMinor,
        packageFeeMinor: quote.packageFeeMinor,
        zoneSurchargeMinor: quote.zoneSurchargeMinor,
        platformFeeMinor: quote.platformFeeMinor,
        taxMinor: quote.taxMinor,
        discountMinor: quote.discountMinor,
      },
    };
  }

  private toPayment(payment: {
    id: string;
    deliveryId: string;
    provider: string;
    providerRef: string;
    amountMinor: number;
    currency: string;
    status: string;
  }): Payment {
    return {
      id: payment.id,
      deliveryId: payment.deliveryId,
      provider: payment.provider as Payment['provider'],
      providerRef: payment.providerRef,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      status: payment.status as PaymentStatus,
    };
  }
}
