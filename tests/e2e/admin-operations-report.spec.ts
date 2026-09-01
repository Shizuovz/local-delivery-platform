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

  await page.getByLabel('Admin User ID').fill(admin.id);
  await page.getByRole('button', { name: 'Load Report' }).click();

  await expect(page.getByText('Load operations report complete')).toBeVisible();
  await expect(page.getByText(/cache (fresh|hit)/)).toBeVisible();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  await expect(page.getByText('Admin Attention', { exact: true })).toBeVisible();
  await expect(page.locator('pre')).toContainText('deliveryCounts');
  await expect(page.locator('pre')).toContainText('dispatchCounts');
});
