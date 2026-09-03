import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PaymentsService } from '../modules/payments/payments.service';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const payments = app.get(PaymentsService);
  const intervalMs = Number(process.env.PAYMENT_RECONCILE_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      log('info', 'payment.reconcile.start');
      const result = await payments.reconcilePendingPayments();
      log('info', 'payment.reconcile.completed', result);
    } catch (error) {
      log('error', 'payment.reconcile.error', undefined, error);
    } finally {
      running = false;
    }
  };

  await run();
  const timer = setInterval(run, intervalMs);

  const shutdown = async () => {
    clearInterval(timer);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void bootstrap();

function log(level: 'info' | 'error', event: string, data?: unknown, error?: unknown) {
  console.log(JSON.stringify({
    service: 'local-delivery-payment-reconciliation-worker',
    timestamp: new Date().toISOString(),
    level,
    event,
    data,
    error: error instanceof Error ? { name: error.name, message: error.message } : undefined,
  }));
}
