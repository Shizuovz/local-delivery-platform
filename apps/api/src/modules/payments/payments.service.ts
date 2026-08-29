import { Injectable } from '@nestjs/common';
import { DeliveryStatus, PaymentStatus, User } from '@local-delivery/types';
import { mockPaymentWebhookSchema } from '@local-delivery/validation';
import { z } from 'zod';
import { ConflictError, ForbiddenError, NotFoundError } from '../../common/domain-errors';
import { InMemoryStore } from '../../common/in-memory-store';
import { PrismaService } from '../../common/prisma.service';
import { DispatchQueueService } from '../dispatch/dispatch.queue';
import { DispatchService } from '../dispatch/dispatch.service';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly dispatchService: DispatchService,
    private readonly prisma: PrismaService,
    private readonly dispatchQueue: DispatchQueueService,
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
            rawEvent: input,
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
            rawEvent: input,
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
          rawEvent: input,
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
