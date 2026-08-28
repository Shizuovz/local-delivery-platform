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
