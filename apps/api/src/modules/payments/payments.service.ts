import { Injectable } from '@nestjs/common';
import { Prisma } from '@local-delivery/database';
import { DeliveryStatus, PaymentStatus, RefundStatus, User } from '@local-delivery/types';
import { mockPaymentWebhookSchema, razorpayWebhookSchema } from '@local-delivery/validation';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { ConflictError, ForbiddenError, NotFoundError } from '../../common/domain-errors';
import { InMemoryStore } from '../../common/in-memory-store';
import { PrismaService } from '../../common/prisma.service';
import { DispatchQueueService } from '../dispatch/dispatch.queue';
import { DispatchService } from '../dispatch/dispatch.service';
import { PaymentProviderService } from './payment-provider.service';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly dispatchService: DispatchService,
    private readonly prisma: PrismaService,
    private readonly dispatchQueue: DispatchQueueService,
    private readonly paymentProvider: PaymentProviderService,
  ) {}

  confirmMockPayment(actor: User, paymentId: string, providerEventId: string) {
    if (this.prisma?.isEnabled()) {
      return this.confirmMockPaymentWithPrisma(actor, paymentId, providerEventId);
    }

    const payment = this.store.payments.get(paymentId);
    if (!payment) throw new NotFoundError('Payment not found');
    const delivery = this.store.deliveries.get(payment.deliveryId);
    if (!delivery) throw new NotFoundError('Delivery not found');
    if (delivery.customerId !== actor.id && !actor.roles.includes('OPS_ADMIN') && !actor.roles.includes('SUPER_ADMIN')) {
      throw new ForbiddenError('Payment does not belong to this user');
    }
    if (this.store.paymentEvents.has(providerEventId)) {
      return { payment, duplicate: true };
    }

    this.store.paymentEvents.add(providerEventId);
    if (payment.status === PaymentStatus.PAID) {
      return { payment, duplicate: false };
    }
    if (payment.status !== PaymentStatus.PENDING && payment.status !== PaymentStatus.CREATED) {
      throw new ConflictError(`Cannot confirm payment from ${payment.status}`);
    }

    payment.status = PaymentStatus.PAID;
    this.store.writeAudit(actor.id, 'payment.mock_confirm', 'payment', payment.id, undefined, { providerEventId });

    if (delivery.status === DeliveryStatus.CONFIRMED) {
      return {
        payment,
        dispatch: this.dispatchQueue.isEnabled()
          ? this.dispatchQueue.enqueueDelivery(delivery.id)
          : this.dispatchService.dispatchDelivery(delivery.id),
      };
    }

    return { payment, dispatch: null };
  }

  handleMockWebhook(signature: string | undefined, input: MockPaymentWebhookInput) {
    this.assertMockWebhookSignature(signature);

    if (this.prisma?.isEnabled()) {
      return this.handleMockWebhookWithPrisma(input);
    }

    if (this.store.paymentEvents.has(input.providerEventId)) {
      const payment = [...this.store.payments.values()].find((candidate) => candidate.providerRef === input.providerRef);
      return { payment, duplicate: true, dispatch: null };
    }

    const payment = [...this.store.payments.values()].find((candidate) => candidate.providerRef === input.providerRef);
    if (!payment) throw new NotFoundError('Payment not found');
    const delivery = this.store.deliveries.get(payment.deliveryId);
    if (!delivery) throw new NotFoundError('Delivery not found');
    if (payment.amountMinor !== input.amountMinor || payment.currency !== input.currency) {
      throw new ConflictError('Webhook amount or currency does not match payment');
    }

    this.store.paymentEvents.add(input.providerEventId);
    this.store.writeAudit(this.systemActorIdFromMemory(), `payment.webhook.${input.status.toLowerCase()}`, 'payment', payment.id, undefined, {
      providerEventId: input.providerEventId,
      providerRef: input.providerRef,
      deliveryId: delivery.id,
    });

    if (input.status === 'FAILED') {
      if (payment.status !== PaymentStatus.PAID && payment.status !== PaymentStatus.REFUNDED) {
        payment.status = PaymentStatus.FAILED;
      }
      return { payment, duplicate: false, dispatch: null };
    }

    if (payment.status === PaymentStatus.PAID) {
      return { payment, duplicate: false, dispatch: null };
    }
    if (payment.status !== PaymentStatus.PENDING && payment.status !== PaymentStatus.CREATED) {
      throw new ConflictError(`Cannot confirm payment from ${payment.status}`);
    }

    payment.status = PaymentStatus.PAID;
    if (delivery.status === DeliveryStatus.CONFIRMED) {
      return {
        payment,
        duplicate: false,
        dispatch: this.dispatchQueue.isEnabled()
          ? this.dispatchQueue.enqueueDelivery(delivery.id)
          : this.dispatchService.dispatchDelivery(delivery.id),
      };
    }

    return { payment, duplicate: false, dispatch: null };
  }

  async handleRazorpayWebhook(signature: string | undefined, rawBody: Buffer | string, body: unknown) {
    this.paymentProvider.verifyRazorpayWebhook(signature, rawBody);
    const input = razorpayWebhookSchema.parse(body);
    if (!this.prisma.isEnabled()) {
      throw new ConflictError('Razorpay webhooks require Prisma persistence mode');
    }

    if (input.event === 'payment.captured' || input.event === 'payment.failed') {
      return this.handleRazorpayPaymentEvent(input);
    }
    if (input.event === 'refund.processed' || input.event === 'refund.failed') {
      return this.handleRazorpayRefundEvent(input);
    }
    return { ignored: true, event: input.event };
  }

  async checkoutForActor(actor: User, paymentId: string) {
    if (!this.prisma.isEnabled()) {
      const payment = this.store.payments.get(paymentId);
      if (!payment) throw new NotFoundError('Payment not found');
      const delivery = this.store.deliveries.get(payment.deliveryId);
      if (!delivery) throw new NotFoundError('Delivery not found');
      this.authorizePaymentReadFromMemory(actor, delivery);
      return this.checkoutPayload(actor, payment);
    }

    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { delivery: { include: { business: true } } },
    });
    if (!payment) throw new NotFoundError('Payment not found');
    this.authorizePaymentReadWithPrisma(actor, payment.delivery);
    return this.checkoutPayload(actor, payment);
  }

  async reconcilePayment(actor: User, paymentId: string, reason: string) {
    this.requireAdmin(actor);
    if (!this.prisma.isEnabled()) {
      const payment = this.store.payments.get(paymentId);
      if (!payment) throw new NotFoundError('Payment not found');
      this.store.writeAudit(actor.id, 'payment.reconcile.mock', 'payment', payment.id, reason, { providerRef: payment.providerRef });
      return { payment, provider: { status: payment.status, providerRef: payment.providerRef }, dispatch: null };
    }

    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { delivery: true },
    });
    if (!payment) throw new NotFoundError('Payment not found');

    const providerState = await this.paymentProvider.reconcilePayment(payment.provider, payment.providerRef);
    const providerEventId = `${payment.provider}:reconcile:${payment.providerRef}:${randomUUID()}`;
    const systemActorId = await this.systemActorIdWithPrisma();
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
        include: { delivery: true },
      });
      await tx.paymentTransaction.create({
        data: {
          paymentId: current.id,
          type: `RECONCILE_${providerState.status}`,
          amountMinor: providerState.amountPaidMinor || current.amountMinor,
          providerRef: current.providerRef,
          providerEventId,
          rawEvent: providerState.raw as Prisma.InputJsonObject,
        },
      });
      const nextStatus = providerState.status === 'PAID' && current.status !== 'REFUNDED'
        ? 'PAID'
        : providerState.status === 'FAILED' && current.status !== 'PAID' && current.status !== 'REFUNDED'
          ? 'FAILED'
          : current.status;
      const nextPayment = await tx.payment.update({
        where: { id: current.id },
        data: { status: nextStatus },
        include: { delivery: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id || systemActorId,
          action: 'payment.reconcile',
          entityType: 'payment',
          entityId: current.id,
          reason,
          metadata: { providerRef: current.providerRef, providerStatus: providerState.status },
        },
      });
      return nextPayment;
    });

    const shouldDispatch = updated.status === 'PAID' && updated.delivery.status === DeliveryStatus.CONFIRMED;
    return {
      payment: this.toPayment(updated),
      provider: providerState,
      dispatch: shouldDispatch
        ? this.dispatchQueue.isEnabled()
          ? await this.dispatchQueue.enqueueDelivery(updated.deliveryId)
          : await this.dispatchService.dispatchDelivery(updated.deliveryId)
        : null,
    };
  }

  async reconcilePendingPayments(reason = 'Scheduled payment reconciliation') {
    if (!this.prisma.isEnabled()) {
      return { reconciled: 0, failed: 0, skipped: 'Prisma persistence is disabled' };
    }

    const minAgeMs = Number(process.env.PAYMENT_RECONCILE_MIN_AGE_MS ?? 5 * 60 * 1000);
    const batchSize = Number(process.env.PAYMENT_RECONCILE_BATCH_SIZE ?? 50);
    const cutoff = new Date(Date.now() - minAgeMs);
    const payments = await this.prisma.payment.findMany({
      where: {
        provider: { not: 'mock' },
        status: { in: ['CREATED', 'PENDING'] },
        createdAt: { lte: cutoff },
      },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });
    const systemActorId = await this.systemActorIdWithPrisma();
    const actor: User = {
      id: systemActorId,
      phone: 'system',
      status: 'ACTIVE',
      roles: ['OPS_ADMIN'],
      createdAt: new Date().toISOString(),
    };
    const results = [];
    let failed = 0;
    for (const payment of payments) {
      try {
        results.push(await this.reconcilePayment(actor, payment.id, reason));
      } catch (error) {
        failed += 1;
        console.error(JSON.stringify({
          service: 'local-delivery-worker',
          timestamp: new Date().toISOString(),
          level: 'error',
          event: 'payment.reconcile.failed',
          paymentId: payment.id,
          provider: payment.provider,
          providerRef: payment.providerRef,
          error: error instanceof Error ? { name: error.name, message: error.message } : { message: 'Unknown error' },
        }));
      }
    }
    return { scanned: payments.length, reconciled: results.length, failed };
  }

  async refundPayment(
    actor: User,
    payment: { id: string; provider: string; providerRef: string; amountMinor: number; currency: string; status: PaymentStatus },
    deliveryId: string,
    reason: string,
    idempotencyKey: string,
  ) {
    if (payment.status !== PaymentStatus.PAID) return null;

    if (!this.prisma.isEnabled()) {
      const existingRefundId = this.store.refundIdempotency.get(idempotencyKey);
      if (existingRefundId) return this.store.refunds.get(existingRefundId);
      const providerRefund = await this.paymentProvider.createRefund({
        provider: payment.provider,
        providerPaymentRef: payment.providerRef,
        paymentId: payment.id,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        idempotencyKey,
        notes: { deliveryId, reason },
      });
      const refund = {
        id: this.store.createId('refund'),
        paymentId: payment.id,
        amountMinor: payment.amountMinor,
        status: providerRefund.status === 'SUCCEEDED' ? RefundStatus.SUCCEEDED : RefundStatus.PROCESSING,
        reason,
        idempotencyKey,
        providerRefundRef: providerRefund.providerRefundRef,
        requestedBy: actor.id,
        processedAt: providerRefund.status === 'SUCCEEDED' ? this.store.now() : undefined,
      };
      this.store.refunds.set(refund.id, refund);
      this.store.refundIdempotency.set(idempotencyKey, refund.id);
      const storedPayment = this.store.payments.get(payment.id);
      if (storedPayment) storedPayment.status = refund.status === 'SUCCEEDED' ? PaymentStatus.REFUNDED : PaymentStatus.REFUND_PENDING;
      this.store.writeAudit(actor.id, `refund.${payment.provider}_${refund.status.toLowerCase()}`, 'refund', refund.id, reason, {
        deliveryId,
        paymentId: payment.id,
        amountMinor: refund.amountMinor,
        providerRefundRef: refund.providerRefundRef,
      });
      return refund;
    }

    const providerPaymentRef = await this.providerPaymentRef(payment.id, payment.provider, payment.providerRef);
    const existing = await this.prisma.refund.findUnique({ where: { idempotencyKey } });
    if (existing) return existing;
    const providerRefund = await this.paymentProvider.createRefund({
      provider: payment.provider,
      providerPaymentRef,
      paymentId: payment.id,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      idempotencyKey,
      notes: { deliveryId, reason },
    });
    const status = providerRefund.status === 'SUCCEEDED'
      ? 'SUCCEEDED'
      : providerRefund.status === 'FAILED'
        ? 'FAILED'
        : 'PROCESSING';
    return this.prisma.$transaction(async (tx) => {
      const refund = await tx.refund.create({
        data: {
          paymentId: payment.id,
          amountMinor: payment.amountMinor,
          status,
          reason,
          idempotencyKey,
          providerRefundRef: providerRefund.providerRefundRef,
          requestedBy: actor.id,
          processedAt: status === 'SUCCEEDED' || status === 'FAILED' ? new Date() : undefined,
        },
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: status === 'SUCCEEDED' ? 'REFUNDED' : status === 'FAILED' ? 'PAID' : 'REFUND_PENDING' },
      });
      await tx.paymentTransaction.create({
        data: {
          paymentId: payment.id,
          type: `REFUND_${status}`,
          amountMinor: payment.amountMinor,
          providerRef: providerRefund.providerRefundRef,
          providerEventId: `${payment.provider}:refund:${providerRefund.providerRefundRef}`,
          rawEvent: providerRefund.raw as Prisma.InputJsonObject,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: `refund.${payment.provider}_${status.toLowerCase()}`,
          entityType: 'refund',
          entityId: refund.id,
          reason,
          metadata: { deliveryId, paymentId: payment.id, amountMinor: refund.amountMinor, providerRefundRef: refund.providerRefundRef },
        },
      });
      return refund;
    });
  }

  private async confirmMockPaymentWithPrisma(actor: User, paymentId: string, providerEventId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { delivery: true },
    });
    if (!payment) throw new NotFoundError('Payment not found');
    if (!payment.delivery) throw new NotFoundError('Delivery not found');
    if (
      payment.delivery.customerId !== actor.id
      && !actor.roles.includes('OPS_ADMIN')
      && !actor.roles.includes('SUPER_ADMIN')
    ) {
      throw new ForbiddenError('Payment does not belong to this user');
    }

    const existingEvent = await this.prisma.paymentTransaction.findUnique({
      where: { providerEventId },
    });
    if (existingEvent) {
      return { payment: this.toPayment(payment), duplicate: true };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        include: { delivery: true },
      });
      if (current.status === 'PAID') {
        await tx.paymentTransaction.create({
          data: {
            paymentId,
            type: 'MOCK_CONFIRM_DUPLICATE_PAID',
            amountMinor: current.amountMinor,
            providerRef: current.providerRef,
            providerEventId,
            rawEvent: { source: 'mock' },
          },
        });
        return current;
      }
      if (current.status !== 'PENDING' && current.status !== 'CREATED') {
        throw new ConflictError(`Cannot confirm payment from ${current.status}`);
      }

      await tx.paymentTransaction.create({
        data: {
          paymentId,
          type: 'MOCK_CONFIRM',
          amountMinor: current.amountMinor,
          providerRef: current.providerRef,
          providerEventId,
          rawEvent: { source: 'mock' },
        },
      });
      const paid = await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'PAID' },
        include: { delivery: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'payment.mock_confirm',
          entityType: 'payment',
          entityId: paymentId,
          metadata: { providerEventId, deliveryId: paid.deliveryId },
        },
      });
      return paid;
    });

    if (updated.delivery.status === DeliveryStatus.CONFIRMED) {
      return {
        payment: this.toPayment(updated),
        duplicate: false,
        dispatch: this.dispatchQueue.isEnabled()
          ? await this.dispatchQueue.enqueueDelivery(updated.deliveryId)
          : await this.dispatchService.dispatchDelivery(updated.deliveryId),
      };
    }

    return { payment: this.toPayment(updated), duplicate: false, dispatch: null };
  }

  private async handleMockWebhookWithPrisma(input: MockPaymentWebhookInput) {
    const existingEvent = await this.prisma.paymentTransaction.findUnique({
      where: { providerEventId: input.providerEventId },
      include: { payment: true },
    });
    if (existingEvent) {
      return { payment: this.toPayment(existingEvent.payment), duplicate: true, dispatch: null };
    }

    const payment = await this.prisma.payment.findFirst({
      where: { provider: 'mock', providerRef: input.providerRef },
      include: { delivery: true },
    });
    if (!payment) throw new NotFoundError('Payment not found');
    if (payment.amountMinor !== input.amountMinor || payment.currency !== input.currency) {
      throw new ConflictError('Webhook amount or currency does not match payment');
    }

    const systemActorId = await this.systemActorIdWithPrisma();
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
        include: { delivery: true },
      });
      if (input.status === 'FAILED') {
        const nextStatus = current.status === 'PAID' || current.status === 'REFUNDED'
          ? current.status
          : 'FAILED';
        await tx.paymentTransaction.create({
          data: {
            paymentId: current.id,
            type: 'MOCK_WEBHOOK_FAILED',
            amountMinor: current.amountMinor,
            providerRef: current.providerRef,
            providerEventId: input.providerEventId,
            rawEvent: input as Prisma.InputJsonObject,
          },
        });
        const failed = await tx.payment.update({
          where: { id: current.id },
          data: { status: nextStatus },
          include: { delivery: true },
        });
        await tx.auditLog.create({
          data: {
            actorId: systemActorId,
            action: 'payment.webhook.failed',
            entityType: 'payment',
            entityId: current.id,
            metadata: { providerEventId: input.providerEventId, deliveryId: current.deliveryId },
          },
        });
        return failed;
      }

      if (current.status === 'PAID') {
        await tx.paymentTransaction.create({
          data: {
            paymentId: current.id,
            type: 'MOCK_WEBHOOK_DUPLICATE_PAID',
            amountMinor: current.amountMinor,
            providerRef: current.providerRef,
            providerEventId: input.providerEventId,
            rawEvent: input as Prisma.InputJsonObject,
          },
        });
        return current;
      }
      if (current.status !== 'PENDING' && current.status !== 'CREATED') {
        throw new ConflictError(`Cannot confirm payment from ${current.status}`);
      }

      await tx.paymentTransaction.create({
        data: {
          paymentId: current.id,
          type: 'MOCK_WEBHOOK_PAID',
          amountMinor: current.amountMinor,
          providerRef: current.providerRef,
          providerEventId: input.providerEventId,
          rawEvent: input as Prisma.InputJsonObject,
        },
      });
      const paid = await tx.payment.update({
        where: { id: current.id },
        data: { status: 'PAID' },
        include: { delivery: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: systemActorId,
          action: 'payment.webhook.paid',
          entityType: 'payment',
          entityId: current.id,
          metadata: { providerEventId: input.providerEventId, deliveryId: current.deliveryId },
        },
      });
      return paid;
    });

    if (input.status === 'PAID' && updated.delivery.status === DeliveryStatus.CONFIRMED) {
      return {
        payment: this.toPayment(updated),
        duplicate: false,
        dispatch: this.dispatchQueue.isEnabled()
          ? await this.dispatchQueue.enqueueDelivery(updated.deliveryId)
          : await this.dispatchService.dispatchDelivery(updated.deliveryId),
      };
    }

    return { payment: this.toPayment(updated), duplicate: false, dispatch: null };
  }

  private requireAdmin(actor: User) {
    if (!actor.roles.includes('OPS_ADMIN') && !actor.roles.includes('SUPER_ADMIN')) {
      throw new ForbiddenError('Admin role required');
    }
  }

  private authorizePaymentReadFromMemory(actor: User, delivery: { customerId?: string; businessId?: string | null }) {
    if (this.isAdmin(actor)) return;
    if (delivery.customerId === actor.id) return;
    if (
      delivery.businessId
      && actor.roles.includes('BUSINESS')
      && this.store.businesses.get(delivery.businessId)?.ownerUserId === actor.id
    ) {
      return;
    }
    throw new ForbiddenError('Payment does not belong to this user');
  }

  private authorizePaymentReadWithPrisma(
    actor: User,
    delivery: { customerId: string | null; business: { ownerUserId: string } | null },
  ) {
    if (this.isAdmin(actor)) return;
    if (delivery.customerId === actor.id) return;
    if (actor.roles.includes('BUSINESS') && delivery.business?.ownerUserId === actor.id) return;
    throw new ForbiddenError('Payment does not belong to this user');
  }

  private isAdmin(actor: User) {
    return actor.roles.includes('OPS_ADMIN') || actor.roles.includes('FINANCE_ADMIN') || actor.roles.includes('SUPER_ADMIN');
  }

  private checkoutPayload(
    actor: User,
    payment: { id: string; deliveryId: string; provider: string; providerRef: string; amountMinor: number; currency: string; status: string },
  ) {
    const base = this.toPayment(payment);
    if (payment.provider === 'mock') {
      return {
        payment: base,
        checkout: {
          mode: 'mock',
          providerRef: payment.providerRef,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
        },
      };
    }
    const keyId = this.paymentProvider.checkoutKeyId(payment.provider);
    return {
      payment: base,
      checkout: {
        mode: payment.provider,
        keyId,
        orderId: payment.providerRef,
        providerRef: payment.providerRef,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        name: 'Local Delivery',
        description: `Delivery ${payment.deliveryId.slice(0, 8)}`,
        prefill: { contact: actor.phone },
      },
    };
  }

  private async handleRazorpayPaymentEvent(input: RazorpayWebhookInput) {
    const paymentEntity = input.payload.payment?.entity;
    if (!paymentEntity?.order_id) throw new ConflictError('Razorpay payment webhook is missing order_id');
    const providerEventId = input.id ?? `razorpay:${input.event}:${paymentEntity.id}:${input.created_at ?? 'no-created-at'}`;
    const existingEvent = await this.prisma.paymentTransaction.findUnique({
      where: { providerEventId },
      include: { payment: true },
    });
    if (existingEvent) {
      return { payment: this.toPayment(existingEvent.payment), duplicate: true, dispatch: null };
    }

    const payment = await this.prisma.payment.findFirst({
      where: { provider: 'razorpay', providerRef: paymentEntity.order_id },
      include: { delivery: true },
    });
    if (!payment) throw new NotFoundError('Payment not found');
    if (payment.amountMinor !== paymentEntity.amount || payment.currency !== paymentEntity.currency) {
      throw new ConflictError('Webhook amount or currency does not match payment');
    }

    const systemActorId = await this.systemActorIdWithPrisma();
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
        include: { delivery: true },
      });
      await tx.paymentTransaction.create({
        data: {
          paymentId: current.id,
          type: input.event === 'payment.captured' ? 'RAZORPAY_PAYMENT_CAPTURED' : 'RAZORPAY_PAYMENT_FAILED',
          amountMinor: paymentEntity.amount,
          providerRef: paymentEntity.id,
          providerEventId,
          rawEvent: input as Prisma.InputJsonObject,
        },
      });
      const nextStatus = input.event === 'payment.captured'
        ? 'PAID'
        : current.status === 'PAID' || current.status === 'REFUNDED'
          ? current.status
          : 'FAILED';
      const nextPayment = await tx.payment.update({
        where: { id: current.id },
        data: { status: nextStatus },
        include: { delivery: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: systemActorId,
          action: input.event === 'payment.captured' ? 'payment.webhook.razorpay_paid' : 'payment.webhook.razorpay_failed',
          entityType: 'payment',
          entityId: current.id,
          metadata: {
            providerEventId,
            providerOrderId: paymentEntity.order_id,
            providerPaymentId: paymentEntity.id,
            deliveryId: current.deliveryId,
          },
        },
      });
      return nextPayment;
    });

    if (input.event === 'payment.captured' && updated.delivery.status === DeliveryStatus.CONFIRMED) {
      return {
        payment: this.toPayment(updated),
        duplicate: false,
        dispatch: this.dispatchQueue.isEnabled()
          ? await this.dispatchQueue.enqueueDelivery(updated.deliveryId)
          : await this.dispatchService.dispatchDelivery(updated.deliveryId),
      };
    }

    return { payment: this.toPayment(updated), duplicate: false, dispatch: null };
  }

  private async handleRazorpayRefundEvent(input: RazorpayWebhookInput) {
    const refundEntity = input.payload.refund?.entity;
    if (!refundEntity) throw new ConflictError('Razorpay refund webhook is missing refund payload');
    const providerEventId = input.id ?? `razorpay:${input.event}:${refundEntity.id}:${input.created_at ?? 'no-created-at'}`;
    const existingEvent = await this.prisma.paymentTransaction.findUnique({
      where: { providerEventId },
      include: { payment: true },
    });
    if (existingEvent) {
      return { payment: this.toPayment(existingEvent.payment), duplicate: true, dispatch: null };
    }

    const refund = await this.prisma.refund.findFirst({
      where: { providerRefundRef: refundEntity.id },
      include: { payment: true },
    });
    if (!refund) throw new NotFoundError('Refund not found');
    const nextRefundStatus = input.event === 'refund.processed' ? 'SUCCEEDED' : 'FAILED';
    const nextPaymentStatus = nextRefundStatus === 'SUCCEEDED' ? 'REFUNDED' : 'PAID';
    const systemActorId = await this.systemActorIdWithPrisma();

    const updated = await this.prisma.$transaction(async (tx) => {
      const nextRefund = await tx.refund.update({
        where: { id: refund.id },
        data: {
          status: nextRefundStatus,
          processedAt: new Date(),
        },
        include: { payment: true },
      });
      const nextPayment = await tx.payment.update({
        where: { id: refund.paymentId },
        data: { status: nextPaymentStatus },
      });
      await tx.paymentTransaction.create({
        data: {
          paymentId: refund.paymentId,
          type: input.event === 'refund.processed' ? 'RAZORPAY_REFUND_PROCESSED' : 'RAZORPAY_REFUND_FAILED',
          amountMinor: refundEntity.amount,
          providerRef: refundEntity.id,
          providerEventId,
          rawEvent: input as Prisma.InputJsonObject,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: systemActorId,
          action: input.event === 'refund.processed' ? 'refund.webhook.razorpay_succeeded' : 'refund.webhook.razorpay_failed',
          entityType: 'refund',
          entityId: refund.id,
          metadata: { providerEventId, providerRefundRef: refundEntity.id, paymentId: refund.paymentId },
        },
      });
      return { refund: nextRefund, payment: nextPayment };
    });

    return { payment: this.toPayment(updated.payment), refund: updated.refund, duplicate: false, dispatch: null };
  }

  private async providerPaymentRef(paymentId: string, provider: string, providerRef: string) {
    if (provider === 'mock') return providerRef;
    const captured = await this.prisma.paymentTransaction.findFirst({
      where: {
        paymentId,
        type: { in: ['RAZORPAY_PAYMENT_CAPTURED', 'RECONCILE_PAID'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (captured?.providerRef && captured.providerRef !== providerRef) return captured.providerRef;
    throw new ConflictError('Captured provider payment reference is required for refund');
  }

  private assertMockWebhookSignature(signature: string | undefined) {
    const expected = process.env.MOCK_PAYMENT_WEBHOOK_SECRET ?? 'dev-mock-payment-secret';
    if (!signature || signature !== expected) {
      throw new ForbiddenError('Invalid payment webhook signature');
    }
  }

  private systemActorIdFromMemory() {
    return [...this.store.users.values()].find((user) => user.roles.includes('OPS_ADMIN'))?.id
      ?? [...this.store.users.values()][0]?.id
      ?? 'system';
  }

  private async systemActorIdWithPrisma() {
    const admin = await this.prisma.user.findFirst({
      where: {
        userRoles: {
          some: {
            role: { code: { in: ['OPS_ADMIN', 'SUPER_ADMIN'] } },
          },
        },
      },
    });
    if (!admin) throw new NotFoundError('System actor not found');
    return admin.id;
  }

  private toPayment(payment: {
    id: string;
    deliveryId: string;
    provider: string;
    providerRef: string;
    amountMinor: number;
    currency: string;
    status: string;
  }) {
    return {
      id: payment.id,
      deliveryId: payment.deliveryId,
      provider: payment.provider,
      providerRef: payment.providerRef,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      status: payment.status as PaymentStatus,
    };
  }
}

type MockPaymentWebhookInput = z.infer<typeof mockPaymentWebhookSchema>;
type RazorpayWebhookInput = z.infer<typeof razorpayWebhookSchema>;
