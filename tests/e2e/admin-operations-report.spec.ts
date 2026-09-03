import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:15432/local_delivery',
    },
  },
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('admin can load cached operations report metrics', async ({ page }) => {
  const admin = await prisma.user.findUniqueOrThrow({
    where: { phone: '+910000000001' },
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Admin Operations' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Operations Report' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Payments And Refunds' })).toBeVisible();

  await page.getByLabel('Admin User ID').fill(admin.id);
  await page.getByRole('button', { name: 'Load Report' }).click();

  await expect(page.getByText('Load operations report complete')).toBeVisible();
  await expect(page.getByText(/cache (fresh|hit)/)).toBeVisible();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  await expect(page.getByText('Admin Attention', { exact: true })).toBeVisible();
  await expect(page.locator('pre')).toContainText('deliveryCounts');
  await expect(page.locator('pre')).toContainText('dispatchCounts');

  await page.getByRole('button', { name: 'Load Payments' }).click();
  await expect(page.getByText('Load payments complete')).toBeVisible();
});

test('admin can review a rider document through signed access', async ({ page }) => {
  const [admin, rider] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { phone: '+910000000001' } }),
    prisma.user.findUniqueOrThrow({ where: { phone: '+910000000002' } }),
  ]);
  const document = await prisma.riderDocument.create({
    data: {
      riderId: rider.id,
      type: 'DRIVING_LICENSE',
      fileUrl: `private/rider-documents/${rider.id}/playwright-license.pdf`,
      status: 'PENDING',
      retentionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  await page.goto('/');
  await page.getByLabel('Admin User ID').fill(admin.id);
  await page.getByLabel('Rider ID').fill(rider.id);
  await page.getByRole('button', { name: 'Load Documents' }).click();

  await expect(page.getByText('Load rider documents complete')).toBeVisible();
  await expect(page.locator('pre').last()).toContainText(document.id);
  await expect(page.locator('pre').last()).toContainText('DRIVING_LICENSE');

  await page.getByRole('button', { name: 'Read Signed Document' }).click();

  await expect(page.getByText('Read rider document complete')).toBeVisible();
  await expect(page.locator('pre').last()).toContainText('fileRef');
  await expect(page.locator('pre').last()).toContainText(`private/rider-documents/${rider.id}/playwright-license.pdf`);
});

test('admin can manage pricing rules and service zones', async ({ page }) => {
  const admin = await prisma.user.findUniqueOrThrow({
    where: { phone: '+910000000001' },
  });
  const suffix = Date.now();
  const pricingCode = `PW-SEND-${suffix}`;
  const zoneCode = `PW-ZONE-${suffix}`;

  await page.goto('/');
  await page.getByLabel('Admin User ID').fill(admin.id);

  await page.getByLabel('Pricing Rule JSON').fill(JSON.stringify({
    code: pricingCode,
    deliveryType: 'SEND',
    active: false,
    currency: 'INR',
    baseFeeMinor: 4100,
    perKmFeeMinor: 900,
    mediumPackageFeeMinor: 1500,
    largePackageFeeMinor: 3200,
    zoneSurchargeMinor: 0,
    platformFeeMinor: 400,
    taxBps: 0,
    discountMinor: 0,
    reason: 'Playwright admin pricing check',
  }, null, 2));
  await page.getByRole('button', { name: 'Save Pricing Rule' }).click();

  await expect(page.getByText('Save pricing rule complete')).toBeVisible();
  await expect(page.getByText(pricingCode).first()).toBeVisible();

  await page.getByLabel('Service Zone JSON').fill(JSON.stringify({
    code: zoneCode,
    name: 'Playwright Zone',
    city: 'Bengaluru',
    active: false,
    centerLat: 12.9716,
    centerLng: 77.5946,
    radiusKm: 1,
    reason: 'Playwright admin zone check',
  }, null, 2));
  await page.getByRole('button', { name: 'Save Service Zone' }).click();

  await expect(page.getByText('Save service zone complete')).toBeVisible();
  await expect(page.getByText(zoneCode).first()).toBeVisible();
});
