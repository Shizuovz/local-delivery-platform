import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'npm run dev:api',
      env: {
        PERSISTENCE_MODE: 'prisma',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:15432/local_delivery',
        REDIS_URL: 'redis://localhost:16379',
        CACHE_MODE: 'off',
      },
      url: 'http://localhost:4000/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
    },
    {
      command: 'npm run dev:admin',
      env: {
        NEXT_PUBLIC_API_URL: 'http://localhost:4000/api/v1',
      },
      url: 'http://localhost:3001',
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
    },
  ],
  projects: [
    {
      name: 'admin-chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
      },
    },
  ],
});
