import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActorService } from './common/actor.service';
import { InMemoryStore } from './common/in-memory-store';
import { PrismaService } from './common/prisma.service';
import { CacheService } from './common/cache.service';
import { ObjectStorageService } from './common/object-storage.service';
import { PrivateFileRetentionService } from './common/private-file-retention.service';
import { quoteDeliverySchema } from '@local-delivery/validation';
import { AuthService } from './modules/auth/auth.service';
import { AdminService } from './modules/admin/admin.service';
import { BusinessesService } from './modules/businesses/businesses.service';
import { DispatchQueueService } from './modules/dispatch/dispatch.queue';
import { DispatchService } from './modules/dispatch/dispatch.service';
import { DeliveriesService } from './modules/deliveries/deliveries.service';
import { PaymentsService } from './modules/payments/payments.service';
import { ProofsService } from './modules/proofs/proofs.service';
import { RidersService } from './modules/riders/riders.service';
import { AssignmentStatus, DeliveryStatus, PaymentStatus, RefundStatus, RiderAvailabilityStatus } from '@local-delivery/types';

const runPrisma = process.env.PERSISTENCE_MODE === 'prisma' ? describe : describe.skip;

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

runPrisma('Prisma-backed functional SEND spine', () => {
  const store = new InMemoryStore();
  const prisma = new PrismaService();
  const dispatchQueue = new DispatchQueueService();
  const dispatch = new DispatchService(store, prisma);
  const storage = new ObjectStorageService();
  const deliveries = new DeliveriesService(store, dispatch, prisma);
  const payments = new PaymentsService(store, dispatch, prisma, dispatchQueue);
  const proofsService = new ProofsService(store, prisma, deliveries, storage);
  const businesses = new BusinessesService(store, prisma, dispatch, dispatchQueue);
  const riders = new RidersService(store, deliveries, dispatch, prisma, storage);
  const actors = new ActorService(store, prisma);
  const auth = new AuthService(store, prisma);
  const cache = noCache();
  const adminService = new AdminService(store, dispatch, prisma, deliveries, cache, storage);
  const privateFileRetention = new PrivateFileRetentionService(store, prisma);

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetRiders();
  });

  it('persists quote, delivery, payment, dispatch, rider lifecycle, proof, history, and admin timeline', async () => {
    const phone = `+9199${Date.now().toString().slice(-8)}`;
    await auth.requestOtp(phone);
    const verified = await auth.verifyOtp(phone, '123456', 'CUSTOMER');
    const customer = verified.user;
    const rider = await actors.requireActor((await prisma.user.findUniqueOrThrow({ where: { phone: '+910000000002' } })).id);
    const admin = await actors.requireActor((await prisma.user.findUniqueOrThrow({ where: { phone: '+910000000001' } })).id);

    const quote = await deliveries.createQuote(customer, quoteInput);
    const created = await deliveries.createDelivery(customer, { quoteId: quote.id, idempotencyKey: `send-${Date.now()}` });
    const duplicateCreate = await deliveries.createDelivery(customer, { quoteId: quote.id, idempotencyKey: created.delivery.idempotencyKey });

    expect(duplicateCreate.delivery.id).toBe(created.delivery.id);

    const paid = await payments.confirmMockPayment(customer, created.payment.id, `evt-${created.delivery.id}`);
    expect(paid.payment.status).toBe('PAID');
    expect(paid.dispatch?.offeredAssignment?.riderId).toBe(rider.id);

    const duplicatePayment = await payments.confirmMockPayment(customer, created.payment.id, `evt-${created.delivery.id}`);
    expect(duplicatePayment.duplicate).toBe(true);

    const accepted = await riders.accept(rider, paid.dispatch!.offeredAssignment!.id);
    await riders.arrivedPickup(rider, accepted.assignment.id);
    await riders.pickedUp(rider, accepted.assignment.id, 'PKUP-123');
    await riders.arrivedDrop(rider, accepted.assignment.id);
    const delivered = await riders.delivered(rider, accepted.assignment.id, { otp: '123456' });

    expect(delivered.status).toBe(DeliveryStatus.DELIVERED);

    const timeline = await adminService.deliveryTimeline(admin, created.delivery.id);
    expect(timeline.history.map((event) => event.status)).toContain('DELIVERED');
    expect(timeline.proofs.length).toBeGreaterThan(0);
    expect(timeline.audits.length).toBeGreaterThan(0);
  });

  it('handles signed mock payment webhooks idempotently', async () => {
    const customer = await createCustomer();
    const rider = await demoRiderActor();
    const created = await createConfirmedDelivery(customer);

    const webhook = await payments.handleMockWebhook('dev-mock-payment-secret', {
      providerEventId: `evt-webhook-${created.delivery.id}`,
      providerRef: created.payment.providerRef,
      status: 'PAID',
      amountMinor: created.payment.amountMinor,
      currency: created.payment.currency,
    });
    const duplicate = await payments.handleMockWebhook('dev-mock-payment-secret', {
      providerEventId: `evt-webhook-${created.delivery.id}`,
      providerRef: created.payment.providerRef,
      status: 'PAID',
      amountMinor: created.payment.amountMinor,
      currency: created.payment.currency,
    });

    expect(webhook.payment.status).toBe(PaymentStatus.PAID);
    expect(webhook.dispatch?.offeredAssignment?.riderId).toBe(rider.id);
    expect(duplicate.duplicate).toBe(true);
  });

  it('refunds paid prepaid cancellation before pickup', async () => {
    const customer = await createCustomer();
    const created = await createConfirmedDelivery(customer);
    await payments.confirmMockPayment(customer, created.payment.id, `evt-cancel-refund-${created.delivery.id}`);

    const cancelled = await deliveries.cancel(customer, created.delivery.id, 'customer cancelled before pickup');
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: created.payment.id },
      include: { refunds: true },
    });

    expect(cancelled.status).toBe(DeliveryStatus.CANCELLED);
    expect(payment.status).toBe(PaymentStatus.REFUNDED);
    expect(payment.refunds).toHaveLength(1);
    expect(payment.refunds[0]).toEqual(expect.objectContaining({
      amountMinor: created.payment.amountMinor,
      status: RefundStatus.SUCCEEDED,
    }));
  });

  it('lets admin cancel paid deliveries with audited refund reconciliation', async () => {
    const customer = await createCustomer();
    const admin = await adminActor();
    const created = await createConfirmedDelivery(customer);
    await payments.confirmMockPayment(customer, created.payment.id, `evt-admin-cancel-refund-${created.delivery.id}`);

    const cancelled = await adminService.cancelDelivery(admin, created.delivery.id, 'support approved cancellation');
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: created.payment.id },
      include: { refunds: true },
    });
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'refund.mock_succeeded', reason: 'support approved cancellation' },
    });

    expect(cancelled.status).toBe(DeliveryStatus.CANCELLED);
    expect(payment.status).toBe(PaymentStatus.REFUNDED);
    expect(payment.refunds).toHaveLength(1);
    expect(audit).toBeTruthy();
  });

  it('lets admin assign the rider already holding the active offer', async () => {
    const customer = await createCustomer();
    const rider = await demoRiderActor();
    const admin = await adminActor();
    const created = await createConfirmedDelivery(customer);
    await payments.confirmMockPayment(customer, created.payment.id, `evt-admin-assign-offered-rider-${created.delivery.id}`);

    const assigned = await adminService.assign(admin, created.delivery.id, rider.id, 'dispatcher confirms offered rider');

    expect(assigned.delivery.assignedRiderId).toBe(rider.id);
    expect(assigned.delivery.status).toBe(DeliveryStatus.RIDER_ASSIGNED);
  });

  it('returns admin operations report counts', async () => {
    const customer = await createCustomer();
    const admin = await adminActor();
    const created = await createConfirmedDelivery(customer);
    await payments.confirmMockPayment(customer, created.payment.id, `evt-admin-report-counts-${created.delivery.id}`);
    await adminService.markDeliveryException(admin, created.delivery.id, 'address needs review');

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

  it('lets admin suspend a rider and cancel their open offers', async () => {
    const customer = await createCustomer();
    const rider = await demoRiderActor();
    const admin = await adminActor();
    const created = await createConfirmedDelivery(customer);
    const offer = (await dispatch.dispatchDelivery(created.delivery.id)).offeredAssignment!;

    const updated = await adminService.updateRiderStatus(admin, rider.id, { suspended: true }, 'documents expired');
    const assignment = await prisma.assignment.findUniqueOrThrow({ where: { id: offer.id } });

    expect(updated.suspended).toBe(true);
    expect(updated.availabilityStatus).toBe(RiderAvailabilityStatus.SUSPENDED);
    expect(assignment.status).toBe(AssignmentStatus.CANCELLED);
    await expect(riders.accept(rider, offer.id)).rejects.toThrow('Assignment is CANCELLED');
  });

  it('lets admin suspend a business and block new delivery creation', async () => {
    const admin = await adminActor();
    const { owner, business } = await createApprovedBusiness('POSTPAID');

    const updated = await adminService.updateBusinessStatus(admin, business.id, 'SUSPENDED', 'compliance review');

    expect(updated.status).toBe('SUSPENDED');
    await expect(businesses.createDelivery(owner, {
      businessId: business.id,
      idempotencyKey: `business-after-suspension-${Date.now()}`,
      ...businessDeliveryInput,
    })).rejects.toThrow('Business is not approved');
  });

  it('lets admin mark an exception and resolve the support ticket', async () => {
    const customer = await createCustomer();
    const admin = await adminActor();
    const created = await createConfirmedDelivery(customer);

    const exception = await adminService.markDeliveryException(admin, created.delivery.id, 'customer address unclear');
    const tickets = await adminService.listSupportTickets(admin);
    const resolved = await adminService.updateSupportTicket(admin, exception.supportTicket.id, 'RESOLVED', 'customer confirmed address');

    expect(tickets.some((ticket) => ticket.id === exception.supportTicket.id)).toBe(true);
    expect(resolved.status).toBe('RESOLVED');
  });

  it('enforces object-level authorization for customer delivery reads', async () => {
    const owner = await createCustomer();
    const otherCustomer = await createCustomer();
    const created = await createConfirmedDelivery(owner);

    await expect(deliveries.getDeliveryForActor(otherCustomer, created.delivery.id)).rejects.toThrow('You cannot access this delivery');
  });

  it('requires delivery proof before completion', async () => {
    const customer = await createCustomer();
    const rider = await demoRiderActor();
    const accepted = await createAcceptedDelivery(customer, rider);

    await riders.arrivedPickup(rider, accepted.assignment.id);
    await riders.pickedUp(rider, accepted.assignment.id, 'PKUP-123');
    await riders.arrivedDrop(rider, accepted.assignment.id);

    await expect(riders.delivered(rider, accepted.assignment.id, {})).rejects.toThrow('Delivery proof is required');
  });

  it('returns signed proof file URLs without exposing raw private refs', async () => {
    const customer = await createCustomer();
    const rider = await demoRiderActor();
    const accepted = await createAcceptedDelivery(customer, rider);

    await riders.arrivedPickup(rider, accepted.assignment.id);
    await riders.pickedUp(rider, accepted.assignment.id, 'PKUP-123');
    await riders.arrivedDrop(rider, accepted.assignment.id);
    await riders.delivered(rider, accepted.assignment.id, { photoUrl: 'https://private.example/proof.jpg' });

    const detail = await deliveries.getDeliveryForActor(customer, accepted.delivery.id);
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

  it('persists private proof object keys from signed upload sessions', async () => {
    const customer = await createCustomer();
    const rider = await demoRiderActor();
    const created = await createConfirmedDelivery(customer);
    const upload = await proofsService.createUploadUrl(customer, {
      deliveryId: created.delivery.id,
      type: 'PHOTO',
      fileName: 'drop-proof.webp',
      contentType: 'image/webp',
    });
    const paid = await payments.confirmMockPayment(customer, created.payment.id, `evt-proof-object-${created.delivery.id}`);
    const accepted = await riders.accept(rider, paid.dispatch!.offeredAssignment!.id);
    await riders.arrivedPickup(rider, accepted.assignment.id);
    await riders.pickedUp(rider, accepted.assignment.id, 'PKUP-123');
    await riders.arrivedDrop(rider, accepted.assignment.id);
    await riders.delivered(rider, accepted.assignment.id, { photoObjectKey: upload.objectKey });

    const detail = await deliveries.getDeliveryForActor(customer, created.delivery.id);
    const proof = detail.proofs.find((item) => item.type === 'PHOTO');
    const signedUrl = new URL(proof!.signedUrl!, 'http://localhost:4000');
    const access = await proofsService.signedFileAccess(
      proof!.id,
      signedUrl.searchParams.get('expires')!,
      signedUrl.searchParams.get('token')!,
    );

    expect(upload.objectKey).toMatch(/^private\/proofs\/.+\/.+-drop-proof\.webp$/);
    expect(proof?.fileUrl).toBeUndefined();
    expect(access.fileRef).toBe(upload.objectKey);
  });

  it('persists signed rider document URLs and expires private file references', async () => {
    const rider = await demoRiderActor();
    const admin = await adminActor();
    const result = await riders.createDocumentUploadUrl(rider, {
      type: 'DRIVING_LICENSE',
      fileName: 'license.pdf',
      contentType: 'application/pdf',
    });
    const riderDocuments = await riders.documents(rider);
    const adminDocuments = await adminService.riderDocuments(admin, rider.id);
    const riderDocument = riderDocuments.find((document) => document.id === result.document.id)!;
    const adminDocument = adminDocuments.find((document) => document.id === result.document.id)!;
    const signedUrl = new URL(riderDocument.signedUrl!, 'http://localhost:4000');
    const access = await riders.signedDocumentAccess(
      riderDocument.id,
      signedUrl.searchParams.get('expires')!,
      signedUrl.searchParams.get('token')!,
    );

    expect(result.upload.objectKey).toMatch(/^private\/rider-documents\/.+\/.+-license\.pdf$/);
    expect(adminDocument).toEqual(expect.objectContaining({ type: 'DRIVING_LICENSE', signedUrl: expect.any(String) }));
    expect(access.fileRef).toBe(result.upload.objectKey);

    await prisma.riderDocument.update({
      where: { id: result.document.id },
      data: { retentionExpiresAt: new Date('2024-01-01T00:00:00.000Z') },
    });
    const cleanup = await privateFileRetention.cleanupExpiredPrivateFiles(new Date('2025-01-01T00:00:00.000Z'));
    const expired = await prisma.riderDocument.findUniqueOrThrow({ where: { id: result.document.id } });

    expect(cleanup.riderDocumentsExpired).toBeGreaterThanOrEqual(1);
    expect(expired.fileUrl).toBeNull();
    expect(expired.status).toBe('EXPIRED');
  });

  it('prevents two riders from accepting the same delivery', async () => {
    const customer = await createCustomer();
    const riderOne = await demoRiderActor();
    const riderTwo = await createRider('ONLINE_IDLE');
    const created = await createConfirmedDelivery(customer);
    const firstOffer = await dispatch.dispatchDelivery(created.delivery.id);
    const secondOffer = await prisma.assignment.create({
      data: {
        deliveryId: created.delivery.id,
        riderId: riderTwo.id,
        status: 'OFFERED',
        expiresAt: new Date(Date.now() + 30_000),
      },
    });
    await prisma.riderProfile.update({
      where: { userId: riderTwo.id },
      data: { availabilityStatus: 'OFFERED_JOB' },
    });

    const results = await Promise.allSettled([
      riders.accept(riderOne, firstOffer.offeredAssignment!.id),
      riders.accept(riderTwo, secondOffer.id),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    const acceptedAssignments = await prisma.assignment.count({
      where: { deliveryId: created.delivery.id, status: 'ACCEPTED' },
    });

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(acceptedAssignments).toBe(1);
  });

  it('excludes stale-location riders from dispatch', async () => {
    await prisma.riderProfile.updateMany({ data: { availabilityStatus: 'OFFLINE', suspended: false } });
    await createRider('ONLINE_IDLE', false, new Date(Date.now() - 10 * 60_000));
    const customer = await createCustomer();
    const created = await createConfirmedDelivery(customer);

    const result = await dispatch.dispatchDelivery(created.delivery.id);

    expect(result.offeredAssignment).toBeNull();
    expect(result.adminAttention).toBe(true);
  });

  it('excludes suspended riders from dispatch and blocks them from going online', async () => {
    await prisma.riderProfile.updateMany({ data: { availabilityStatus: 'OFFLINE', suspended: false } });
    const suspended = await createRider('ONLINE_IDLE', true);
    const customer = await createCustomer();
    const created = await createConfirmedDelivery(customer);

    const result = await dispatch.dispatchDelivery(created.delivery.id);

    expect(result.offeredAssignment).toBeNull();
    expect(result.adminAttention).toBe(true);
    await expect(riders.setAvailability(suspended, true)).rejects.toThrow('Suspended riders cannot go online');
  });

  it('prevents a delivered delivery from moving backward', async () => {
    const customer = await createCustomer();
    const rider = await demoRiderActor();
    const accepted = await createAcceptedDelivery(customer, rider);

    await riders.arrivedPickup(rider, accepted.assignment.id);
    await riders.pickedUp(rider, accepted.assignment.id, 'PKUP-123');
    await riders.arrivedDrop(rider, accepted.assignment.id);
    const delivered = await riders.delivered(rider, accepted.assignment.id, { otp: '123456' });

    await expect(deliveries.transition(delivered.id, DeliveryStatus.EN_ROUTE_DROP, rider.id, 'invalid rewind')).rejects.toThrow('Delivery is terminal');
  });

  it('creates a postpaid business delivery with settlement and dispatch', async () => {
    const { owner, business } = await createApprovedBusiness('POSTPAID');
    const rider = await demoRiderActor();

    const result = await businesses.createDelivery(owner, {
      businessId: business.id,
      idempotencyKey: `business-${Date.now()}`,
      ...businessDeliveryInput,
    });

    expect(result.delivery.type).toBe('BUSINESS_DELIVERY');
    expect(result.delivery.status).toBe(DeliveryStatus.SEARCHING_RIDER);
    expect(result.settlement?.status).toBe('OPEN');
    expect(result.payment).toBeUndefined();
    expect((result.dispatch as { offeredAssignment?: { riderId: string } }).offeredAssignment?.riderId).toBe(rider.id);
  });

  it('blocks another business from reading a business delivery', async () => {
    const { owner, business } = await createApprovedBusiness('POSTPAID');
    const other = await createApprovedBusiness('POSTPAID');
    const result = await businesses.createDelivery(owner, {
      businessId: business.id,
      idempotencyKey: `business-auth-${Date.now()}`,
      ...businessDeliveryInput,
    });

    await expect(businesses.getDelivery(other.owner, result.delivery.id)).rejects.toThrow('You cannot access this delivery');
  });

  it('requires pickup proof for business deliveries', async () => {
    const { owner, business } = await createApprovedBusiness('POSTPAID');
    const rider = await demoRiderActor();
    const result = await businesses.createDelivery(owner, {
      businessId: business.id,
      idempotencyKey: `business-proof-${Date.now()}`,
      ...businessDeliveryInput,
    });
    const assignmentId = (result.dispatch as { offeredAssignment: { id: string } }).offeredAssignment.id;
    const accepted = await riders.accept(rider, assignmentId);
    await riders.arrivedPickup(rider, accepted.assignment.id);

    await expect(riders.pickedUp(rider, accepted.assignment.id)).rejects.toThrow('Pickup proof is required for this delivery type');
  });

  it('creates prepaid LIMITED_FETCH and dispatches after payment', async () => {
    const customer = await createCustomer();
    const rider = await demoRiderActor();
    const quote = await deliveries.createQuote(customer, limitedFetchInput);
    const created = await deliveries.createDelivery(customer, { quoteId: quote.id, idempotencyKey: `limited-fetch-${Date.now()}` });
    const persistedQuote = await prisma.deliveryQuote.findUniqueOrThrow({ where: { id: quote.id } });

    expect(quote.type).toBe('LIMITED_FETCH');
    expect(created.delivery.type).toBe('LIMITED_FETCH');
    expect(created.payment.status).toBe('PENDING');
    expect(persistedQuote.metadata).toEqual(expect.objectContaining({
      limitedFetch: expect.objectContaining({
        pickupReference: 'ORDER-123',
        itemAlreadyPaid: true,
        riderPaymentAllowed: false,
        substitutionAllowed: false,
      }),
    }));

    const paid = await payments.confirmMockPayment(customer, created.payment.id, `evt-limited-fetch-${Date.now()}`);
    expect(paid.dispatch?.offeredAssignment?.riderId).toBe(rider.id);
  });

  it('requires pickup proof for LIMITED_FETCH deliveries', async () => {
    const customer = await createCustomer();
    const rider = await demoRiderActor();
    const quote = await deliveries.createQuote(customer, limitedFetchInput);
    const created = await deliveries.createDelivery(customer, { quoteId: quote.id, idempotencyKey: `limited-fetch-proof-${Date.now()}` });
    const paid = await payments.confirmMockPayment(customer, created.payment.id, `evt-limited-fetch-proof-${Date.now()}`);
    const accepted = await riders.accept(rider, paid.dispatch!.offeredAssignment!.id);
    await riders.arrivedPickup(rider, accepted.assignment.id);

    await expect(riders.pickedUp(rider, accepted.assignment.id)).rejects.toThrow('Pickup proof is required for this delivery type');
  });

  it('rejects rider-funded purchase fields for LIMITED_FETCH quotes', () => {
    const result = quoteDeliverySchema.safeParse({
      ...limitedFetchInput,
      riderPaymentAmountMinor: 50000,
    });

    expect(result.success).toBe(false);
  });

  async function createCustomer() {
    const phone = `+9198${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)}`;
    await auth.requestOtp(phone);
    return (await auth.verifyOtp(phone, '123456', 'CUSTOMER')).user;
  }

  function noCache(): CacheService {
    return {
      getJson: async () => undefined,
      setJson: async () => undefined,
      delete: async () => undefined,
      onModuleDestroy: async () => undefined,
    } as CacheService;
  }

  async function createConfirmedDelivery(customer: Awaited<ReturnType<typeof createCustomer>>) {
    const quote = await deliveries.createQuote(customer, quoteInput);
    return deliveries.createDelivery(customer, { quoteId: quote.id, idempotencyKey: `send-${Date.now()}-${Math.random()}` });
  }

  async function createAcceptedDelivery(customer: Awaited<ReturnType<typeof createCustomer>>, rider: Awaited<ReturnType<typeof demoRiderActor>>) {
    const created = await createConfirmedDelivery(customer);
    const paid = await payments.confirmMockPayment(customer, created.payment.id, `evt-${created.delivery.id}-${Date.now()}`);
    return riders.accept(rider, paid.dispatch!.offeredAssignment!.id);
  }

  async function demoRiderActor() {
    const rider = await prisma.user.findUniqueOrThrow({ where: { phone: '+910000000002' } });
    return actors.requireActor(rider.id);
  }

  async function adminActor() {
    const admin = await prisma.user.findUniqueOrThrow({ where: { phone: '+910000000001' } });
    return actors.requireActor(admin.id);
  }

  async function resetRiders() {
    const rider = await prisma.user.findUniqueOrThrow({ where: { phone: '+910000000002' } });
    await prisma.riderProfile.updateMany({
      data: { availabilityStatus: 'OFFLINE', suspended: false },
    });
    await prisma.riderProfile.update({
      where: { userId: rider.id },
      data: { approvalStatus: 'APPROVED', availabilityStatus: 'ONLINE_IDLE', suspended: false },
    });
    await prisma.riderLocation.create({
      data: { riderId: rider.id, lat: 12.9716, lng: 77.5946 },
    });
  }

  async function createRider(availabilityStatus: 'ONLINE_IDLE' | 'OFFERED_JOB' | 'OFFLINE', suspended = false, recordedAt = new Date()) {
    const user = await prisma.user.create({
      data: {
        phone: `+9177${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)}`,
        status: 'ACTIVE',
      },
    });
    const role = await prisma.role.upsert({
      where: { code: 'RIDER' },
      update: {},
      create: { code: 'RIDER' },
    });
    await prisma.userRole.create({
      data: { userId: user.id, roleId: role.id },
    });
    await prisma.riderProfile.create({
      data: {
        userId: user.id,
        approvalStatus: 'APPROVED',
        availabilityStatus,
        vehicleType: 'BIKE',
        activeJobLimit: 1,
        suspended,
      },
    });
    await prisma.riderLocation.create({
      data: {
        riderId: user.id,
        lat: 12.9716,
        lng: 77.5946,
        recordedAt,
      },
    });
    return actors.requireActor(user.id);
  }

  async function createApprovedBusiness(billingMode: 'PREPAID' | 'POSTPAID') {
    const user = await prisma.user.create({
      data: {
        phone: `+9166${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)}`,
        status: 'ACTIVE',
      },
    });
    const role = await prisma.role.upsert({
      where: { code: 'BUSINESS' },
      update: {},
      create: { code: 'BUSINESS' },
    });
    await prisma.userRole.create({
      data: { userId: user.id, roleId: role.id },
    });
    const business = await prisma.business.create({
      data: {
        ownerUserId: user.id,
        name: 'Test Business',
        status: 'APPROVED',
        billingMode,
      },
    });
    return { owner: await actors.requireActor(user.id), business };
  }
});

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
