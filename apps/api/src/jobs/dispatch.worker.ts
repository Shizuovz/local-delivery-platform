import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import { AppModule } from '../app.module';
import {
  DISPATCH_DELIVERY_QUEUE,
  DISPATCH_OFFER_TIMEOUT_QUEUE,
  DispatchDeliveryJobData,
  DispatchOfferTimeoutJobData,
  DispatchQueueService,
} from '../modules/dispatch/dispatch.queue';
import { DispatchService } from '../modules/dispatch/dispatch.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const dispatch = app.get(DispatchService);
  const queues = app.get(DispatchQueueService);
  const connection = { url: process.env.REDIS_URL ?? 'redis://localhost:16379' };

  const deliveryWorker = new Worker<DispatchDeliveryJobData>(
    DISPATCH_DELIVERY_QUEUE,
    async (job) => {
      logWorkerEvent('info', 'worker.job.start', job.queueName, job.id, job.data);
      const result = await dispatch.dispatchDelivery(job.data.deliveryId);
      if (result.offeredAssignment?.id) {
        await queues.enqueueOfferTimeout(result.offeredAssignment.id);
      }
      return result;
    },
    { connection },
  );

  const offerTimeoutWorker = new Worker<DispatchOfferTimeoutJobData>(
    DISPATCH_OFFER_TIMEOUT_QUEUE,
    async (job) => {
      logWorkerEvent('info', 'worker.job.start', job.queueName, job.id, job.data);
      const result = await dispatch.expireOffer(job.data.assignmentId);
      if (
        result
        && typeof result === 'object'
        && 'nextDispatch' in result
      ) {
        const nextDispatch = await Promise.resolve(result.nextDispatch);
        if (nextDispatch?.offeredAssignment?.id) {
          await queues.enqueueOfferTimeout(nextDispatch.offeredAssignment.id);
        }
      }
      return result;
    },
    { connection },
  );

  for (const worker of [deliveryWorker, offerTimeoutWorker]) {
    worker.on('completed', (job) => {
      logWorkerEvent('info', 'worker.job.completed', job.queueName, job.id, job.data);
    });
    worker.on('failed', (job, error) => {
      logWorkerEvent('error', 'worker.job.failed', job?.queueName, job?.id, job?.data, error);
    });
    worker.on('error', (error) => {
      logWorkerEvent('error', 'worker.error', worker.name, undefined, undefined, error);
    });
  }

  process.on('SIGINT', async () => {
    await deliveryWorker.close();
    await offerTimeoutWorker.close();
    await app.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await deliveryWorker.close();
    await offerTimeoutWorker.close();
    await app.close();
    process.exit(0);
  });
}

void bootstrap();

function logWorkerEvent(
  level: 'info' | 'warn' | 'error',
  event: string,
  queueName?: string,
  jobId?: string,
  data?: { deliveryId?: string; assignmentId?: string },
  error?: Error,
) {
  console.log(JSON.stringify({
    service: 'local-delivery-worker',
    timestamp: new Date().toISOString(),
    level,
    event,
    queueName,
    jobId,
    deliveryId: data?.deliveryId,
    assignmentId: data?.assignmentId,
    error: error ? { name: error.name, message: error.message } : undefined,
  }));
}
