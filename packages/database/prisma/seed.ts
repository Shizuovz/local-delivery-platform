import { PrismaClient, RiderAvailabilityStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const roles = ['CUSTOMER', 'RIDER', 'BUSINESS', 'OPS_ADMIN', 'FINANCE_ADMIN', 'SUPER_ADMIN'];

  for (const code of roles) {
    await prisma.role.upsert({
      where: { code },
      update: {},
      create: { code },
    });
  }

  const admin = await prisma.user.upsert({
    where: { phone: '+910000000001' },
    update: { name: 'Ops Admin', status: 'ACTIVE' },
    create: { phone: '+910000000001', name: 'Ops Admin', status: 'ACTIVE' },
  });

  const rider = await prisma.user.upsert({
    where: { phone: '+910000000002' },
    update: { name: 'Demo Rider', status: 'ACTIVE' },
    create: { phone: '+910000000002', name: 'Demo Rider', status: 'ACTIVE' },
  });

  for (const roleCode of ['OPS_ADMIN', 'SUPER_ADMIN']) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: admin.id, roleId: role.id } },
      update: {},
      create: { userId: admin.id, roleId: role.id },
    });
  }

  const riderRole = await prisma.role.findUniqueOrThrow({ where: { code: 'RIDER' } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: rider.id, roleId: riderRole.id } },
    update: {},
    create: { userId: rider.id, roleId: riderRole.id },
  });

  await prisma.riderProfile.upsert({
    where: { userId: rider.id },
    update: {
      approvalStatus: 'APPROVED',
      availabilityStatus: RiderAvailabilityStatus.ONLINE_IDLE,
      suspended: false,
    },
    create: {
      userId: rider.id,
      approvalStatus: 'APPROVED',
      availabilityStatus: RiderAvailabilityStatus.ONLINE_IDLE,
      vehicleType: 'BIKE',
      activeJobLimit: 1,
      suspended: false,
    },
  });

  await prisma.riderLocation.create({
    data: {
      riderId: rider.id,
      lat: 12.9716,
      lng: 77.5946,
    },
  });

  await prisma.serviceZone.upsert({
    where: { code: 'BLR-CENTRAL' },
    update: { active: true },
    create: {
      code: 'BLR-CENTRAL',
      name: 'Bengaluru Central Demo Zone',
      city: 'Bengaluru',
      active: true,
      centerLat: 12.9716,
      centerLng: 77.5946,
      radiusKm: 12,
    },
  });
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
