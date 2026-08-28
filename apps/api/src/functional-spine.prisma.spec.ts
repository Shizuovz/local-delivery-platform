import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActorService } from './common/actor.service';
import { InMemoryStore } from './common/in-memory-store';
import { PrismaService } from './common/prisma.service';
import { AuthService } from './modules/auth/auth.service';
import { AdminService } from './modules/admin/admin.service';
import { DispatchQueueService } from './modules/dispatch/dispatch.queue';
import { DispatchService } from './modules/dispatch/dispatch.service';
import { DeliveriesService } from './modules/deliveries/deliveries.service';
import { PaymentsService } from './modules/payments/payments.service';
import { RidersService } from './modules/riders/riders.service';
import { DeliveryStatus } from '@local-delivery/types';

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
  const deliveries = new DeliveriesService(store, dispatch, prisma);
  const payments = new PaymentsService(store, dispatch, prisma, dispatchQueue);
  const riders = new RidersService(store, deliveries, dispatch, prisma);
  const actors = new ActorService(store, prisma);
  const auth = new AuthService(store, prisma);
  const adminService = new AdminService(store, dispatch, prisma);

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

  async function createCustomer() {
    const phone = `+9198${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)}`;
    await auth.requestOtp(phone);
    return (await auth.verifyOtp(phone, '123456', 'CUSTOMER')).user;
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

  async function resetRiders() {
    const rider = await prisma.user.findUniqueOrThrow({ where: { phone: '+910000000002' } });
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
});
