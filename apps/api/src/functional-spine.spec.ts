import { describe, expect, it } from 'vitest';
import { InMemoryStore } from './common/in-memory-store';
import { PrismaService } from './common/prisma.service';
import { CacheService } from './common/cache.service';
import { quoteDeliverySchema } from '@local-delivery/validation';
import { DispatchQueueService } from './modules/dispatch/dispatch.queue';
import { DispatchService } from './modules/dispatch/dispatch.service';
import { DeliveriesService } from './modules/deliveries/deliveries.service';
import { BusinessesService } from './modules/businesses/businesses.service';
import { AdminService } from './modules/admin/admin.service';
import { PaymentsService } from './modules/payments/payments.service';
import { ProofsService } from './modules/proofs/proofs.service';
import { RidersService } from './modules/riders/riders.service';
import { AssignmentStatus, DeliveryStatus, DeliveryType, PaymentStatus, RefundStatus, RiderAvailabilityStatus } from '@local-delivery/types';

const runInMemory = process.env.PERSISTENCE_MODE === 'prisma' ? describe.skip : describe;

function setup() {
  const store = new InMemoryStore();
  const prisma = new PrismaService();
  const dispatchQueue = new DispatchQueueService();
  const dispatch = new DispatchService(store, prisma);
  const deliveries = new DeliveriesService(store, dispatch, prisma);
  const payments = new PaymentsService(store, dispatch, prisma, dispatchQueue);
  const proofsService = new ProofsService(store, prisma);
  const businesses = new BusinessesService(store, prisma, dispatch, dispatchQueue);
  const cache = noCache();
  const adminService = new AdminService(store, dispatch, prisma, deliveries, cache);
  const riders = new RidersService(store, deliveries, dispatch, prisma);
  const customer = store.findOrCreateUser('+919999999999', ['CUSTOMER']);
  const rider = [...store.users.values()].find((user) => user.roles.includes('RIDER'))!;
  const admin = [...store.users.values()].find((user) => user.roles.includes('OPS_ADMIN'))!;
  const businessUser = [...store.users.values()].find((user) => user.roles.includes('BUSINESS'))!;
  const business = [...store.businesses.values()][0];
  return { store, dispatch, deliveries, payments, proofsService, businesses, adminService, riders, customer, rider, admin, businessUser, business };
}

function noCache(): CacheService {
  return {
    getJson: async () => undefined,
    setJson: async () => undefined,
    delete: async () => undefined,
    onModuleDestroy: async () => undefined,
  } as CacheService;
}

const quoteInput = {
  type: 'SEND' as const,
  pickupAddress: {
    line1: 'MG Road',
    city: 'Bengaluru',
    lat: 12.9716,
    lng: 77.5946,
  },
  dropAddress: {
    line1: 'Indiranagar',
    city: 'Bengaluru',
    lat: 12.9784,
    lng: 77.6408,
  },
  item: {
    description: 'Documents',
    packageClass: 'SMALL' as const,
    quantity: 1,
  },
};

runInMemory('functional SEND spine', () => {
  it('creates quote, delivery, confirms payment, dispatches, accepts, and delivers with proof', () => {
    const { deliveries, payments, riders, customer, rider } = setup();
    const quote = deliveries.createQuote(customer, quoteInput);
    const created = deliveries.createDelivery(customer, { quoteId: quote.id, idempotencyKey: 'send-001' });

    const paid = payments.confirmMockPayment(customer, created.payment.id, 'evt-send-001');
    expect(paid.payment.status).toBe('PAID');
    expect(paid.dispatch?.offeredAssignment?.riderId).toBe(rider.id);

    const accepted = riders.accept(rider, paid.dispatch!.offeredAssignment!.id);
    expect(accepted.delivery.status).toBe(DeliveryStatus.RIDER_ASSIGNED);

    riders.arrivedPickup(rider, accepted.assignment.id);
    riders.pickedUp(rider, accepted.assignment.id, 'PKUP-123');
    riders.arrivedDrop(rider, accepted.assignment.id);
    const delivered = riders.delivered(rider, accepted.assignment.id, { otp: '123456' });

    expect(delivered.status).toBe(DeliveryStatus.DELIVERED);
  });

  it('returns the same delivery for duplicate create requests with the same idempotency key', () => {
    const { deliveries, customer } = setup();
    const quote = deliveries.createQuote(customer, quoteInput);
    const first = deliveries.createDelivery(customer, { quoteId: quote.id, idempotencyKey: 'same-key' });
    const second = deliveries.createDelivery(customer, { quoteId: quote.id, idempotencyKey: 'same-key' });

    expect(second.delivery.id).toBe(first.delivery.id);
  });

  it('blocks delivery completion without proof', () => {
    const { deliveries, payments, riders, customer, rider } = setup();
    const quote = deliveries.createQuote(customer, quoteInput);
    const created = deliveries.createDelivery(customer, { quoteId: quote.id, idempotencyKey: 'send-002' });
    const paid = payments.confirmMockPayment(customer, created.payment.id, 'evt-send-002');
    const accepted = riders.accept(rider, paid.dispatch!.offeredAssignment!.id);
    riders.arrivedPickup(rider, accepted.assignment.id);
    riders.pickedUp(rider, accepted.assignment.id, 'PKUP-123');
    riders.arrivedDrop(rider, accepted.assignment.id);

    expect(() => riders.delivered(rider, accepted.assignment.id, {})).toThrow('Delivery proof is required');
  });

  it('returns signed proof file URLs without exposing raw private refs', async () => {
    const { deliveries, payments, proofsService, riders, customer, rider } = setup();
    const quote = deliveries.createQuote(customer, quoteInput);
    const created = deliveries.createDelivery(customer, { quoteId: quote.id, idempotencyKey: 'send-photo-proof' });
    const paid = payments.confirmMockPayment(customer, created.payment.id, 'evt-photo-proof');
    const accepted = riders.accept(rider, paid.dispatch!.offeredAssignment!.id);
    riders.arrivedPickup(rider, accepted.assignment.id);
    riders.pickedUp(rider, accepted.assignment.id, 'PKUP-123');
    riders.arrivedDrop(rider, accepted.assignment.id);
    riders.delivered(rider, accepted.assignment.id, { photoUrl: 'https://private.example/proof.jpg' });

    const detail = await deliveries.getDeliveryForActor(customer, created.delivery.id);
    const photoProof = detail.proofs.find((proof) => proof.type === 'PHOTO');
    expect(photoProof?.fileUrl).toBeUndefined();
    expect(photoProof?.signedUrl).toContain(`/api/v1/proofs/${photoProof.id}/file`);
    expect(photoProof?.retentionExpiresAt).toBeTruthy();

    const signedUrl = new URL(photoProof!.signedUrl!, 'http://localhost:4000');
    const access = await proofsService.signedFileAccess(
      photoProof!.id,
      signedUrl.searchParams.get('expires')!,
      signedUrl.searchParams.get('token')!,
    );
    expect(access.fileRef).toBe('https://private.example/proof.jpg');
    await expect(proofsService.signedFileAccess(photoProof!.id, '1', 'bad-token')).rejects.toThrow('Invalid or expired proof file URL');
  });

  it('handles duplicate payment webhook simulation idempotently', () => {
    const { deliveries, payments, customer } = setup();
    const quote = deliveries.createQuote(customer, quoteInput);
    const created = deliveries.createDelivery(customer, { quoteId: quote.id, idempotencyKey: 'send-003' });

    payments.confirmMockPayment(customer, created.payment.id, 'evt-dup');
    const duplicate = payments.confirmMockPayment(customer, created.payment.id, 'evt-dup');

    expect(duplicate.duplicate).toBe(true);
  });

  it('handles signed mock payment webhooks idempotently and dispatches paid deliveries', () => {
    const { deliveries, payments, customer, rider } = setup();
    const quote = deliveries.createQuote(customer, quoteInput);
    const created = deliveries.createDelivery(customer, { quoteId: quote.id, idempotencyKey: 'send-webhook-001' });

    const webhook = payments.handleMockWebhook('dev-mock-payment-secret', {
      providerEventId: 'evt-webhook-001',
      providerRef: created.payment.providerRef,
      status: 'PAID',
      amountMinor: created.payment.amountMinor,
      currency: created.payment.currency,
    });
    const duplicate = payments.handleMockWebhook('dev-mock-payment-secret', {
      providerEventId: 'evt-webhook-001',
      providerRef: created.payment.providerRef,
      status: 'PAID',
      amountMinor: created.payment.amountMinor,
      currency: created.payment.currency,
    });

    expect(webhook.payment.status).toBe(PaymentStatus.PAID);
    expect(webhook.dispatch?.offeredAssignment?.riderId).toBe(rider.id);
    expect(duplicate.duplicate).toBe(true);
  });

  it('rejects mock payment webhooks with an invalid signature', () => {
    const { deliveries, payments, customer } = setup();
    const quote = deliveries.createQuote(customer, quoteInput);
    const created = deliveries.createDelivery(customer, { quoteId: quote.id, idempotencyKey: 'send-webhook-bad-signature' });

    expect(() => payments.handleMockWebhook('bad-signature', {
      providerEventId: 'evt-webhook-bad-signature',
      providerRef: created.payment.providerRef,
      status: 'PAID',
      amountMinor: created.payment.amountMinor,
      currency: created.payment.currency,
    })).toThrow('Invalid payment webhook signature');
  });

  it('refunds paid prepaid delivery cancellation before pickup', () => {
    const { store, deliveries, payments, customer } = setup();
    const quote = deliveries.createQuote(customer, quoteInput);
    const created = deliveries.createDelivery(customer, { quoteId: quote.id, idempotencyKey: 'send-cancel-refund' });
    const paid = payments.confirmMockPayment(customer, created.payment.id, 'evt-cancel-refund');

    const cancelled = deliveries.cancel(customer, created.delivery.id, 'customer cancelled before pickup');
    const refunds = [...store.refunds.values()].filter((refund) => refund.paymentId === created.payment.id);

    expect(cancelled.status).toBe(DeliveryStatus.CANCELLED);
    expect(paid.payment.status).toBe(PaymentStatus.REFUNDED);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toEqual(expect.objectContaining({
      amountMinor: created.payment.amountMinor,
      status: RefundStatus.SUCCEEDED,
    }));
  });

  it('lets admin cancel paid deliveries with audited refund reconciliation', () => {
    const { store, deliveries, payments, adminService, customer, admin } = setup();
    const quote = deliveries.createQuote(customer, quoteInput);
    const created = deliveries.createDelivery(customer, { quoteId: quote.id, idempotencyKey: 'admin-cancel-refund' });
    payments.confirmMockPayment(customer, created.payment.id, 'evt-admin-cancel-refund');

    const cancelled = adminService.cancelDelivery(admin, created.delivery.id, 'support approved cancellation');

    expect(cancelled.status).toBe(DeliveryStatus.CANCELLED);
    expect(store.payments.get(created.payment.id)?.status).toBe(PaymentStatus.REFUNDED);
    expect([...store.refunds.values()]).toEqual([
      expect.objectContaining({ paymentId: created.payment.id, status: RefundStatus.SUCCEEDED }),
    ]);
    expect(store.auditLogs.some((log) => log.action === 'refund.mock_succeeded' && log.reason === 'support approved cancellation')).toBe(true);
  });

  it('lets admin assign the rider already holding the active offer', () => {
    const { deliveries, payments, adminService, customer, rider, admin } = setup();
    const quote = deliveries.createQuote(customer, quoteInput);
    const created = deliveries.createDelivery(customer, { quoteId: quote.id, idempotencyKey: 'admin-assign-offered-rider' });
    payments.confirmMockPayment(customer, created.payment.id, 'evt-admin-assign-offered-rider');

    const assigned = adminService.assign(admin, created.delivery.id, rider.id, 'dispatcher confirms offered rider');

    expect(assigned.delivery.assignedRiderId).toBe(rider.id);
    expect(assigned.delivery.status).toBe(DeliveryStatus.RIDER_ASSIGNED);
  });

  it('returns admin operations report counts', async () => {
    const { deliveries, payments, adminService, customer, admin } = setup();
    const quote = deliveries.createQuote(customer, quoteInput);
    const created = deliveries.createDelivery(customer, { quoteId: quote.id, idempotencyKey: 'admin-report-counts' });
    payments.confirmMockPayment(customer, created.payment.id, 'evt-admin-report-counts');
    adminService.markDeliveryException(admin, created.delivery.id, 'address needs review');

    const report = await adminService.operationsReport(admin);

    expect(report.cache).toEqual(expect.objectContaining({
      key: 'cache:v1:admin:operations-report',
      ttlSeconds: 15,
      hit: false,
    }));
    expect(report.deliveryCounts.searchingRider).toBeGreaterThanOrEqual(1);
    expect(report.paymentCounts.paid).toBeGreaterThanOrEqual(1);
    expect(report.supportCounts.open).toBeGreaterThanOrEqual(1);
    expect(report.dispatchCounts.adminAttention).toBeGreaterThanOrEqual(1);
  });

  it('lets admin suspend a rider and cancel their open offers', () => {
    const { store, deliveries, dispatch, adminService, riders, customer, rider, admin } = setup();
    const quote = deliveries.createQuote(customer, quoteInput);
    const created = deliveries.createDelivery(customer, { quoteId: quote.id, idempotencyKey: 'admin-suspend-rider' });
    const offer = dispatch.dispatchDelivery(created.delivery.id).offeredAssignment!;

    const updated = adminService.updateRiderStatus(admin, rider.id, { suspended: true }, 'documents expired');

    expect(updated.suspended).toBe(true);
    expect(updated.availabilityStatus).toBe(RiderAvailabilityStatus.SUSPENDED);
    expect(store.assignments.get(offer.id)?.status).toBe(AssignmentStatus.CANCELLED);
    expect(() => riders.accept(rider, offer.id)).toThrow('Assignment is CANCELLED');
  });

  it('lets admin suspend a business and block new delivery creation', () => {
    const { businesses, adminService, businessUser, business, admin } = setup();

    const updated = adminService.updateBusinessStatus(admin, business.id, 'SUSPENDED', 'compliance review');

    expect(updated.status).toBe('SUSPENDED');
    expect(() => businesses.createDelivery(businessUser, {
      businessId: business.id,
      idempotencyKey: 'business-after-suspension',
      ...businessDeliveryInput,
    })).toThrow('Business is not approved');
  });

  it('lets admin mark an exception and resolve the support ticket', () => {
    const { deliveries, adminService, customer, admin } = setup();
    const quote = deliveries.createQuote(customer, quoteInput);
    const created = deliveries.createDelivery(customer, { quoteId: quote.id, idempotencyKey: 'admin-exception' });

    const exception = adminService.markDeliveryException(admin, created.delivery.id, 'customer address unclear');
    const tickets = adminService.listSupportTickets(admin);
    const resolved = adminService.updateSupportTicket(admin, exception.supportTicket.id, 'RESOLVED', 'customer confirmed address');

    expect(tickets.some((ticket) => ticket.id === exception.supportTicket.id)).toBe(true);
    expect(resolved.status).toBe('RESOLVED');
  });

  it('expires an offer and retries the next eligible rider', () => {
    const { store, deliveries, payments, dispatch, customer, rider } = setup();
    const secondRider = createOnlineRider(store, '+910000000003');

    const quote = deliveries.createQuote(customer, quoteInput);
    const created = deliveries.createDelivery(customer, { quoteId: quote.id, idempotencyKey: 'send-retry' });
    const paid = payments.confirmMockPayment(customer, created.payment.id, 'evt-retry');
    const firstOffer = paid.dispatch!.offeredAssignment!;

    const result = dispatch.expireOffer(firstOffer.id) as {
      expiredAssignment: { status: AssignmentStatus };
      nextDispatch: { offeredAssignment: { riderId: string } | null; adminAttention: boolean };
    };

    expect(result.expiredAssignment.status).toBe(AssignmentStatus.EXPIRED);
    expect(result.nextDispatch.adminAttention).toBe(false);
    expect(result.nextDispatch.offeredAssignment?.riderId).toBe(secondRider.id);
    expect(result.nextDispatch.offeredAssignment?.riderId).not.toBe(rider.id);
  });

  it('returns the active offer instead of creating duplicate live offers', () => {
    const { store, deliveries, dispatch, customer } = setup();
    createOnlineRider(store, '+910000000004');
    const quote = deliveries.createQuote(customer, quoteInput);
    const created = deliveries.createDelivery(customer, { quoteId: quote.id, idempotencyKey: 'send-duplicate-dispatch' });

    const first = dispatch.dispatchDelivery(created.delivery.id);
    const second = dispatch.dispatchDelivery(created.delivery.id);
    const liveOffers = [...store.assignments.values()].filter((assignment) => assignment.deliveryId === created.delivery.id && assignment.status === AssignmentStatus.OFFERED);

    expect(second.offeredAssignment?.id).toBe(first.offeredAssignment?.id);
    expect(liveOffers).toHaveLength(1);
  });

  it('retries the next eligible rider after offer rejection', () => {
    const { store, deliveries, dispatch, customer, rider } = setup();
    const secondRider = createOnlineRider(store, '+910000000005');
    const quote = deliveries.createQuote(customer, quoteInput);
    const created = deliveries.createDelivery(customer, { quoteId: quote.id, idempotencyKey: 'send-reject-retry' });
    const firstOffer = dispatch.dispatchDelivery(created.delivery.id).offeredAssignment!;

    const result = dispatch.rejectAssignment(rider, firstOffer.id) as {
      rejectedAssignment: { status: AssignmentStatus };
      nextDispatch: { offeredAssignment: { riderId: string } | null; adminAttention: boolean };
    };

    expect(result.rejectedAssignment.status).toBe(AssignmentStatus.REJECTED);
    expect(result.nextDispatch.adminAttention).toBe(false);
    expect(result.nextDispatch.offeredAssignment?.riderId).toBe(secondRider.id);
  });

  it('moves dispatch to admin attention after assignment attempts are exhausted', () => {
    const { store, deliveries, dispatch, customer } = setup();
    const quote = deliveries.createQuote(customer, quoteInput);
    const created = deliveries.createDelivery(customer, { quoteId: quote.id, idempotencyKey: 'send-admin-attention' });
    const first = dispatch.dispatchDelivery(created.delivery.id).offeredAssignment!;
    dispatch.expireOffer(first.id);

    const result = dispatch.dispatchDelivery(created.delivery.id);

    expect(result.adminAttention).toBe(true);
    expect(result.offeredAssignment).toBeNull();
    expect([...store.supportTickets.values()].some((ticket) => ticket.deliveryId === created.delivery.id && ticket.category === 'DISPATCH_UNASSIGNED')).toBe(true);
    expect(store.auditLogs.some((log) => log.action === 'dispatch.admin_attention' && log.entityId === created.delivery.id)).toBe(true);
  });

  it('creates a postpaid business delivery with settlement and dispatch', () => {
    const { businesses, businessUser, business, rider } = setup();

    const result = businesses.createDelivery(businessUser, {
      businessId: business.id,
      idempotencyKey: 'business-send-001',
      ...businessDeliveryInput,
    });

    expect(result.delivery.type).toBe(DeliveryType.BUSINESS_DELIVERY);
    expect(result.delivery.status).toBe(DeliveryStatus.SEARCHING_RIDER);
    expect(result.settlement?.status).toBe('OPEN');
    expect(result.payment).toBeUndefined();
    expect((result.dispatch as { offeredAssignment?: { riderId: string } }).offeredAssignment?.riderId).toBe(rider.id);
  });

  it('blocks another business from reading a business delivery', () => {
    const { businesses, store, businessUser, business } = setup();
    const result = businesses.createDelivery(businessUser, {
      businessId: business.id,
      idempotencyKey: 'business-send-002',
      ...businessDeliveryInput,
    });
    const otherBusinessUser = store.findOrCreateUser('+910000000011', ['BUSINESS']);

    expect(() => businesses.getDelivery(otherBusinessUser, result.delivery.id)).toThrow('You cannot access this delivery');
  });

  it('requires pickup proof for business deliveries', () => {
    const { businesses, riders, businessUser, business, rider } = setup();
    const result = businesses.createDelivery(businessUser, {
      businessId: business.id,
      idempotencyKey: 'business-send-003',
      ...businessDeliveryInput,
    });
    const assignmentId = (result.dispatch as { offeredAssignment: { id: string } }).offeredAssignment.id;
    const accepted = riders.accept(rider, assignmentId);
    riders.arrivedPickup(rider, accepted.assignment.id);

    expect(() => riders.pickedUp(rider, accepted.assignment.id)).toThrow('Pickup proof is required for this delivery type');
  });

  it('creates prepaid LIMITED_FETCH and dispatches after payment', () => {
    const { deliveries, payments, customer, rider } = setup();
    const quote = deliveries.createQuote(customer, limitedFetchInput);
    const created = deliveries.createDelivery(customer, { quoteId: quote.id, idempotencyKey: 'limited-fetch-001' });

    expect(quote.type).toBe(DeliveryType.LIMITED_FETCH);
    expect(created.delivery.type).toBe(DeliveryType.LIMITED_FETCH);
    expect(created.payment.status).toBe('PENDING');

    const paid = payments.confirmMockPayment(customer, created.payment.id, 'evt-limited-fetch-001');
    expect(paid.dispatch?.offeredAssignment?.riderId).toBe(rider.id);
  });

  it('requires pickup proof for LIMITED_FETCH deliveries', () => {
    const { deliveries, payments, riders, customer, rider } = setup();
    const quote = deliveries.createQuote(customer, limitedFetchInput);
    const created = deliveries.createDelivery(customer, { quoteId: quote.id, idempotencyKey: 'limited-fetch-002' });
    const paid = payments.confirmMockPayment(customer, created.payment.id, 'evt-limited-fetch-002');
    const accepted = riders.accept(rider, paid.dispatch!.offeredAssignment!.id);
    riders.arrivedPickup(rider, accepted.assignment.id);

    expect(() => riders.pickedUp(rider, accepted.assignment.id)).toThrow('Pickup proof is required for this delivery type');
  });

  it('rejects rider-funded purchase fields for LIMITED_FETCH quotes', () => {
    const result = quoteDeliverySchema.safeParse({
      ...limitedFetchInput,
      riderPaymentAmountMinor: 50000,
    });

    expect(result.success).toBe(false);
  });
});

function createOnlineRider(store: InMemoryStore, phone: string) {
  const rider = store.findOrCreateUser(phone, ['RIDER']);
  store.riders.set(rider.id, {
    userId: rider.id,
    approvalStatus: 'APPROVED',
    availabilityStatus: RiderAvailabilityStatus.ONLINE_IDLE,
    vehicleType: 'BIKE',
    activeJobLimit: 1,
    suspended: false,
  });
  store.locations.set(rider.id, {
    riderId: rider.id,
    lat: 12.9717,
    lng: 77.5947,
    recordedAt: store.now(),
  });
  return rider;
}

const businessDeliveryInput = {
  pickupAddress: {
    line1: 'Business Pickup',
    city: 'Bengaluru',
    lat: 12.9716,
    lng: 77.5946,
  },
  dropAddress: {
    line1: 'Customer Drop',
    city: 'Bengaluru',
    lat: 12.98,
    lng: 77.61,
  },
  item: {
    description: 'Business package',
    packageClass: 'SMALL' as const,
    quantity: 1,
  },
};

const limitedFetchInput = {
  type: 'LIMITED_FETCH' as const,
  pickupAddress: {
    line1: 'Known Pickup Counter',
    city: 'Bengaluru',
    lat: 12.9716,
    lng: 77.5946,
  },
  dropAddress: {
    line1: 'Home Drop',
    city: 'Bengaluru',
    lat: 12.98,
    lng: 77.61,
  },
  item: {
    description: 'Already paid parcel',
    packageClass: 'SMALL' as const,
    quantity: 1,
  },
  pickupReference: 'ORDER-123',
  pickupInstructions: 'Collect from prepaid pickup counter',
  itemAlreadyPaid: true as const,
};
