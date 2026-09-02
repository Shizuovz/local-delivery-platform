import { Injectable } from '@nestjs/common';
import {
  Business,
  BusinessSettlement,
  Delivery,
  DeliveryItem,
  DeliveryQuote,
  DeliveryStatus,
  DeliveryType,
  Payment,
  PaymentStatus,
  User,
} from '@local-delivery/types';
import { ConflictError, ForbiddenError, NotFoundError } from '../../common/domain-errors';
import { InMemoryStore } from '../../common/in-memory-store';
import { PrismaService } from '../../common/prisma.service';
import { DispatchQueueService } from '../dispatch/dispatch.queue';
import { DispatchService } from '../dispatch/dispatch.service';
import { PricingService } from '../pricing/pricing.service';
import { ServiceZonesService } from '../service-zones/service-zones.service';
import { CreateBusinessDeliveryDto } from './businesses.dto';

interface BusinessDeliveryResult {
  business: Business;
  quote: DeliveryQuote;
  delivery: Delivery;
  payment?: Payment;
  settlement?: BusinessSettlement;
  dispatch?: unknown;
}

@Injectable()
export class BusinessesService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly prisma: PrismaService,
    private readonly dispatchService: DispatchService,
    private readonly dispatchQueue: DispatchQueueService,
    private readonly pricingService: PricingService,
    private readonly serviceZonesService: ServiceZonesService,
  ) {}

  profile(actor: User) {
    this.requireBusinessRole(actor);
    if (this.prisma.isEnabled()) {
      return this.businessesForActorWithPrisma(actor);
    }

    return [...this.store.businesses.values()].filter((business) => business.ownerUserId === actor.id);
  }

  createDelivery(actor: User, input: CreateBusinessDeliveryDto): BusinessDeliveryResult | Promise<BusinessDeliveryResult> {
    this.requireBusinessRole(actor);
    if (this.prisma.isEnabled()) {
      return this.createDeliveryWithPrisma(actor, input);
    }

    const business = this.requireApprovedBusinessFromMemory(actor, input.businessId);
    const existingDeliveryId = this.store.deliveryIdempotency.get(this.idempotencyScope(business.id, input.idempotencyKey));
    if (existingDeliveryId) {
      const existing = this.businessDeliveryDetailFromMemory(actor, existingDeliveryId);
      return {
        business,
        quote: existing.quote!,
        delivery: existing.delivery,
        payment: existing.payment,
        settlement: existing.settlement,
      };
    }

    const pickup = { id: this.store.createId('addr'), ...input.pickupAddress };
    const drop = { id: this.store.createId('addr'), ...input.dropAddress };
    const quote = this.createBusinessQuoteFromMemory(actor, business, pickup.id, drop.id, input);
    const now = this.store.now();
    const delivery: Delivery = {
      id: this.store.createId('del'),
      type: DeliveryType.BUSINESS_DELIVERY,
      status: DeliveryStatus.CONFIRMED,
      businessId: business.id,
      quoteId: quote.id,
      pickupAddressId: quote.pickupAddressId,
      dropAddressId: quote.dropAddressId,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
      updatedAt: now,
    };
    const quoteItem = this.store.deliveryItems.get(quote.id);
    if (quoteItem) {
      const deliveryItem: DeliveryItem = { ...quoteItem, id: this.store.createId('item'), deliveryId: delivery.id };
      this.store.deliveryItems.set(deliveryItem.id, deliveryItem);
    }

    const result: BusinessDeliveryResult = { business, quote, delivery };
    if (business.billingMode === 'PREPAID') {
      const payment: Payment = {
        id: this.store.createId('pay'),
        deliveryId: delivery.id,
        provider: 'mock',
        providerRef: `mock_business_${delivery.id}`,
        amountMinor: quote.amountMinor,
        currency: quote.currency,
        status: PaymentStatus.PENDING,
      };
      delivery.paymentId = payment.id;
      this.store.payments.set(payment.id, payment);
      result.payment = payment;
    } else {
      const settlement: BusinessSettlement = {
        id: this.store.createId('bst'),
        businessId: business.id,
        deliveryId: delivery.id,
        amountMinor: quote.amountMinor,
        currency: quote.currency,
        status: 'OPEN',
      };
      this.store.businessSettlements.set(settlement.id, settlement);
      result.settlement = settlement;
    }

    this.store.deliveries.set(delivery.id, delivery);
    this.store.deliveryIdempotency.set(this.idempotencyScope(business.id, input.idempotencyKey), delivery.id);
    this.store.writeHistory(delivery.id, DeliveryStatus.CONFIRMED, actor.id, 'Business delivery created from quote');
    this.store.writeAudit(actor.id, 'business.delivery.create', 'delivery', delivery.id, undefined, { businessId: business.id, billingMode: business.billingMode });

    if (business.billingMode === 'POSTPAID') {
      result.dispatch = this.dispatchQueue.isEnabled()
        ? this.dispatchQueue.enqueueDelivery(delivery.id)
        : this.dispatchService.dispatchDelivery(delivery.id);
    }

    return result;
  }

  listDeliveries(actor: User, businessId?: string) {
    this.requireBusinessRole(actor);
    if (this.prisma.isEnabled()) {
      return this.listDeliveriesWithPrisma(actor, businessId);
    }

    const allowedBusinessIds = this.businessIdsForActorFromMemory(actor);
    return [...this.store.deliveries.values()]
      .filter((delivery) => delivery.businessId && allowedBusinessIds.has(delivery.businessId))
      .filter((delivery) => !businessId || delivery.businessId === businessId);
  }

  getDelivery(actor: User, deliveryId: string) {
    this.requireBusinessRole(actor);
    if (this.prisma.isEnabled()) {
      return this.getDeliveryWithPrisma(actor, deliveryId);
    }

    return this.businessDeliveryDetailFromMemory(actor, deliveryId);
  }

  private createBusinessQuoteFromMemory(
    actor: User,
    business: Business,
    pickupAddressId: string,
    dropAddressId: string,
    input: CreateBusinessDeliveryDto,
  ): DeliveryQuote {
    const zone = this.serviceZonesService.zoneForPairFromMemory(input.pickupAddress, input.dropAddress);
    const distanceMeters = Math.max(1000, this.distanceMeters(input.pickupAddress.lat, input.pickupAddress.lng, input.dropAddress.lat, input.dropAddress.lng));
    const pricing = this.pricingService.calculateFromMemory({
      deliveryType: DeliveryType.BUSINESS_DELIVERY,
      packageClass: input.item.packageClass,
      distanceMeters,
      zoneCode: zone.code,
    });
    const quote: DeliveryQuote = {
      id: this.store.createId('quote'),
      type: DeliveryType.BUSINESS_DELIVERY,
      businessId: business.id,
      pickupAddressId,
      dropAddressId,
      distanceMeters,
      amountMinor: pricing.amountMinor,
      currency: pricing.currency,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      metadata: { pricingRuleCode: pricing.pricingRuleCode, zoneCode: pricing.zoneCode },
      pricing,
    };
    this.store.quotes.set(quote.id, quote);
    this.store.deliveryItems.set(quote.id, {
      id: this.store.createId('item'),
      deliveryId: quote.id,
      ...input.item,
    });
    this.store.writeAudit(actor.id, 'business.quote.create', 'delivery_quote', quote.id, undefined, { businessId: business.id });
    return quote;
  }

  private async createDeliveryWithPrisma(actor: User, input: CreateBusinessDeliveryDto): Promise<BusinessDeliveryResult> {
    const business = await this.requireApprovedBusinessWithPrisma(actor, input.businessId);
    const existing = await this.prisma.delivery.findFirst({
      where: { businessId: business.id, idempotencyKey: input.idempotencyKey },
      include: { quote: true, payments: true, businessSettlements: true },
    });
    if (existing) {
      return {
        business,
        quote: this.toQuote(existing.quote),
        delivery: this.toDelivery(existing, existing.payments[0]?.id ?? existing.paymentId ?? undefined),
        payment: existing.payments[0] ? this.toPayment(existing.payments[0]) : undefined,
        settlement: existing.businessSettlements[0] ? this.toSettlement(existing.businessSettlements[0]) : undefined,
      };
    }

    const zone = await this.serviceZonesService.zoneForPair(input.pickupAddress, input.dropAddress);
    const distanceMeters = Math.max(1000, this.distanceMeters(input.pickupAddress.lat, input.pickupAddress.lng, input.dropAddress.lat, input.dropAddress.lng));
    const pricing = await this.pricingService.calculate({
      deliveryType: DeliveryType.BUSINESS_DELIVERY,
      packageClass: input.item.packageClass,
      distanceMeters,
      zoneCode: zone.code,
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const pickup = await tx.address.create({ data: input.pickupAddress });
      const drop = await tx.address.create({ data: input.dropAddress });
      const quote = await tx.deliveryQuote.create({
        data: {
          type: 'BUSINESS_DELIVERY',
          businessId: business.id,
          pickupAddressId: pickup.id,
          dropAddressId: drop.id,
          distanceMeters,
          amountMinor: pricing.amountMinor,
          currency: 'INR',
          baseFeeMinor: pricing.baseFeeMinor,
          distanceFeeMinor: pricing.distanceFeeMinor,
          packageFeeMinor: pricing.packageFeeMinor,
          zoneSurchargeMinor: pricing.zoneSurchargeMinor,
          platformFeeMinor: pricing.platformFeeMinor,
          taxMinor: pricing.taxMinor,
          discountMinor: pricing.discountMinor,
          metadata: { pricingRuleCode: pricing.pricingRuleCode, zoneCode: pricing.zoneCode },
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
          confirmedAt: new Date(),
        },
      });
      const delivery = await tx.delivery.create({
        data: {
          type: 'BUSINESS_DELIVERY',
          status: 'CONFIRMED',
          businessId: business.id,
          quoteId: quote.id,
          pickupAddressId: pickup.id,
          dropAddressId: drop.id,
          idempotencyKey: input.idempotencyKey,
        },
      });
      await tx.deliveryItem.create({
        data: {
          deliveryId: delivery.id,
          description: input.item.description,
          packageClass: input.item.packageClass,
          approximateWeightGrams: input.item.approximateWeightGrams,
          quantity: input.item.quantity,
          declaredValueMinor: input.item.declaredValueMinor,
          notes: input.item.notes,
        },
      });
      const payment = business.billingMode === 'PREPAID'
        ? await tx.payment.create({
          data: {
            deliveryId: delivery.id,
            provider: 'mock',
            providerRef: `mock_business_${delivery.id}`,
            amountMinor: quote.amountMinor,
            currency: quote.currency,
            status: 'PENDING',
          },
        })
        : null;
      const settlement = business.billingMode === 'POSTPAID'
        ? await tx.businessSettlement.create({
          data: {
            businessId: business.id,
            deliveryId: delivery.id,
            amountMinor: quote.amountMinor,
            currency: quote.currency,
            status: 'OPEN',
          },
        })
        : null;
      const updatedDelivery = payment
        ? await tx.delivery.update({ where: { id: delivery.id }, data: { paymentId: payment.id } })
        : delivery;
      await tx.deliveryStatusHistory.create({
        data: {
          deliveryId: delivery.id,
          status: 'CONFIRMED',
          actorId: actor.id,
          reason: 'Business delivery created from quote',
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'business.delivery.create',
          entityType: 'delivery',
          entityId: delivery.id,
          metadata: { businessId: business.id, billingMode: business.billingMode },
        },
      });
      await tx.idempotencyKey.create({
        data: {
          actorId: actor.id,
          action: 'business.delivery.create',
          key: input.idempotencyKey,
          entityType: 'delivery',
          entityId: delivery.id,
        },
      });
      return { quote, delivery: updatedDelivery, payment, settlement };
    });

    const response: BusinessDeliveryResult = {
      business,
      quote: this.toQuote(result.quote),
      delivery: this.toDelivery(result.delivery, result.payment?.id),
      payment: result.payment ? this.toPayment(result.payment) : undefined,
      settlement: result.settlement ? this.toSettlement(result.settlement) : undefined,
    };
    if (business.billingMode === 'POSTPAID') {
      const dispatch = this.dispatchQueue.isEnabled()
        ? await this.dispatchQueue.enqueueDelivery(result.delivery.id)
        : await this.dispatchService.dispatchDelivery(result.delivery.id);
      response.dispatch = dispatch;
      if (
        dispatch
        && typeof dispatch === 'object'
        && 'delivery' in dispatch
        && dispatch.delivery
      ) {
        response.delivery = dispatch.delivery as Delivery;
      }
    }
    return response;
  }

  private async listDeliveriesWithPrisma(actor: User, businessId?: string) {
    const businesses = await this.businessesForActorWithPrisma(actor);
    const allowedIds = new Set(businesses.map((business) => business.id));
    if (businessId && !allowedIds.has(businessId)) throw new ForbiddenError('You cannot access this business');
    const deliveries = await this.prisma.delivery.findMany({
      where: { businessId: businessId ?? { in: [...allowedIds] } },
      orderBy: { createdAt: 'desc' },
      include: { payments: true, businessSettlements: true },
    });
    return deliveries.map((delivery) => ({
      ...this.toDelivery(delivery, delivery.payments[0]?.id ?? delivery.paymentId ?? undefined),
      payment: delivery.payments[0] ? this.toPayment(delivery.payments[0]) : undefined,
      settlement: delivery.businessSettlements[0] ? this.toSettlement(delivery.businessSettlements[0]) : undefined,
    }));
  }

  private async getDeliveryWithPrisma(actor: User, deliveryId: string) {
    const businesses = await this.businessesForActorWithPrisma(actor);
    const allowedIds = new Set(businesses.map((business) => business.id));
    const detail = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: {
        quote: true,
        payments: true,
        businessSettlements: true,
        assignments: true,
        proofs: true,
        history: { orderBy: { timestamp: 'asc' } },
      },
    });
    if (!detail) throw new NotFoundError('Delivery not found');
    if (!detail.businessId || !allowedIds.has(detail.businessId)) throw new ForbiddenError('You cannot access this delivery');
    return {
      delivery: this.toDelivery(detail, detail.payments[0]?.id ?? detail.paymentId ?? undefined),
      quote: this.toQuote(detail.quote),
      payment: detail.payments[0] ? this.toPayment(detail.payments[0]) : undefined,
      settlement: detail.businessSettlements[0] ? this.toSettlement(detail.businessSettlements[0]) : undefined,
      assignments: detail.assignments,
      proofs: detail.proofs,
      history: detail.history,
    };
  }

  private businessDeliveryDetailFromMemory(actor: User, deliveryId: string) {
    const delivery = this.store.deliveries.get(deliveryId);
    if (!delivery) throw new NotFoundError('Delivery not found');
    const allowedBusinessIds = this.businessIdsForActorFromMemory(actor);
    if (!delivery.businessId || !allowedBusinessIds.has(delivery.businessId)) throw new ForbiddenError('You cannot access this delivery');
    return {
      delivery,
      quote: this.store.quotes.get(delivery.quoteId),
      payment: delivery.paymentId ? this.store.payments.get(delivery.paymentId) : undefined,
      settlement: [...this.store.businessSettlements.values()].find((settlement) => settlement.deliveryId === delivery.id),
      assignments: [...this.store.assignments.values()].filter((assignment) => assignment.deliveryId === delivery.id),
      proofs: [...this.store.proofs.values()].filter((proof) => proof.deliveryId === delivery.id),
      history: this.store.history.filter((event) => event.deliveryId === delivery.id),
    };
  }

  private requireBusinessRole(actor: User) {
    if (!actor.roles.includes('BUSINESS')) throw new ForbiddenError('Business role required');
  }

  private requireApprovedBusinessFromMemory(actor: User, businessId: string) {
    const business = this.store.businesses.get(businessId);
    if (!business) throw new NotFoundError('Business not found');
    if (business.ownerUserId !== actor.id) throw new ForbiddenError('You cannot access this business');
    if (business.status !== 'APPROVED') throw new ForbiddenError('Business is not approved');
    return business;
  }

  private businessIdsForActorFromMemory(actor: User) {
    return new Set([...this.store.businesses.values()].filter((business) => business.ownerUserId === actor.id).map((business) => business.id));
  }

  private async requireApprovedBusinessWithPrisma(actor: User, businessId: string) {
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundError('Business not found');
    if (business.ownerUserId !== actor.id) throw new ForbiddenError('You cannot access this business');
    if (business.status !== 'APPROVED') throw new ForbiddenError('Business is not approved');
    return this.toBusiness(business);
  }

  private async businessesForActorWithPrisma(actor: User) {
    const businesses = await this.prisma.business.findMany({
      where: { ownerUserId: actor.id },
      orderBy: { createdAt: 'desc' },
    });
    return businesses.map((business) => this.toBusiness(business));
  }

  private idempotencyScope(businessId: string, key: string) {
    return `${businessId}:business_delivery:create:${key}`;
  }

  private distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
    const kmPerDegree = 111;
    const x = (lng2 - lng1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
    const y = lat2 - lat1;
    return Math.round(Math.sqrt(x * x + y * y) * kmPerDegree * 1000);
  }

  private toBusiness(business: { id: string; ownerUserId: string; name: string; status: string; billingMode: string }): Business {
    return {
      id: business.id,
      ownerUserId: business.ownerUserId,
      name: business.name,
      status: business.status as Business['status'],
      billingMode: business.billingMode as Business['billingMode'],
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
    metadata?: unknown;
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
      metadata: this.jsonObject(quote.metadata),
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

  private jsonObject(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  }

  private toPayment(payment: { id: string; deliveryId: string; provider: string; providerRef: string; amountMinor: number; currency: string; status: string }): Payment {
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

  private toSettlement(settlement: { id: string; businessId: string; deliveryId: string; amountMinor: number; currency: string; status: string }): BusinessSettlement {
    return {
      id: settlement.id,
      businessId: settlement.businessId,
      deliveryId: settlement.deliveryId,
      amountMinor: settlement.amountMinor,
      currency: settlement.currency,
      status: settlement.status as BusinessSettlement['status'],
    };
  }
}
