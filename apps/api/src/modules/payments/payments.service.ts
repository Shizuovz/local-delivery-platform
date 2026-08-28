import { Injectable } from '@nestjs/common';
import { DeliveryStatus, PaymentStatus, User } from '@local-delivery/types';
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
