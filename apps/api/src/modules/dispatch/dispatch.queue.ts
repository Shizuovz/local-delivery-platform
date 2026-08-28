import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue } from 'bullmq';

export const DISPATCH_DELIVERY_QUEUE = 'dispatch.delivery';
export const DISPATCH_OFFER_TIMEOUT_QUEUE = 'dispatch.offer-timeout';

export interface DispatchDeliveryJobData {
  deliveryId: string;
}

export interface DispatchOfferTimeoutJobData {
  assignmentId: string;
}

@Injectable()
export class DispatchQueueService implements OnModuleDestroy {
  private deliveryQueue?: Queue<DispatchDeliveryJobData>;
  private offerTimeoutQueue?: Queue<DispatchOfferTimeoutJobData>;

  isEnabled() {
    return process.env.DISPATCH_QUEUE_MODE === 'bullmq';
  }

  async enqueueDelivery(deliveryId: string) {
    if (!this.isEnabled()) {
      return { queued: false, deliveryId };
    }

    const job = await this.getDeliveryQueue().add(
      DISPATCH_DELIVERY_QUEUE,
      { deliveryId },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        jobId: `delivery-${deliveryId}`,
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
    return this.toQueuedResult(job);
  }

  async enqueueOfferTimeout(assignmentId: string, delayMs = 30_000) {
    if (!this.isEnabled()) {
      return { queued: false, assignmentId };
    }

    const job = await this.getOfferTimeoutQueue().add(
      DISPATCH_OFFER_TIMEOUT_QUEUE,
      { assignmentId },
      {
        attempts: 3,
        delay: delayMs,
        backoff: { type: 'fixed', delay: 2_000 },
        jobId: `offer-timeout-${assignmentId}`,
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
    return this.toQueuedResult(job);
  }

  async onModuleDestroy() {
    await this.deliveryQueue?.close();
    await this.offerTimeoutQueue?.close();
  }

  private getDeliveryQueue() {
    this.deliveryQueue ??= new Queue<DispatchDeliveryJobData>(DISPATCH_DELIVERY_QUEUE, {
      connection: this.connection(),
    });
    return this.deliveryQueue;
  }

  private getOfferTimeoutQueue() {
    this.offerTimeoutQueue ??= new Queue<DispatchOfferTimeoutJobData>(DISPATCH_OFFER_TIMEOUT_QUEUE, {
      connection: this.connection(),
    });
    return this.offerTimeoutQueue;
  }

  private connection() {
    return {
      url: process.env.REDIS_URL ?? 'redis://localhost:16379',
    };
  }

  private toQueuedResult(job: Job) {
    return {
      queued: true,
      queueName: job.queueName,
      jobId: job.id,
    };
  }
}
