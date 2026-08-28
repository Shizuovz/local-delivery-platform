import { ArgumentsHost } from '@nestjs/common';
import { Queue } from 'bullmq';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { ConflictError } from './common/domain-errors';
import { RateLimitService } from './common/rate-limit.service';
import {
  DISPATCH_DELIVERY_QUEUE,
  DISPATCH_OFFER_TIMEOUT_QUEUE,
  DispatchQueueService,
} from './modules/dispatch/dispatch.queue';

function mockHost() {
  const status = vi.fn().mockReturnThis();
  const json = vi.fn();
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { 'x-request-id': 'req_test' } }),
      getResponse: () => ({ status, json }),
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('API runtime hardening', () => {
  it('returns consistent domain error responses', () => {
    const filter = new ApiExceptionFilter();
    const { host, status, json } = mockHost();

    filter.catch(new ConflictError('Delivery already has an accepted assignment'), host);

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      error: {
        code: 'CONFLICT',
        message: 'Delivery already has an accepted assignment',
      },
      requestId: 'req_test',
    }));
  });

  it('returns consistent Zod validation responses', () => {
    const filter = new ApiExceptionFilter();
    const { host, status, json } = mockHost();
    const result = z.object({ phone: z.string().min(4) }).safeParse({ phone: '1' });

    if (result.success) throw new Error('Expected validation failure');
    filter.catch(result.error, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
      }),
      requestId: 'req_test',
    }));
  });

  it('blocks requests after the configured rate limit is exceeded', () => {
    const limiter = new RateLimitService();
    const policy = { key: 'auth.request_otp', limit: 2, windowMs: 60_000 };

    limiter.consume(policy, '+919999999999');
    limiter.consume(policy, '+919999999999');

    expect(() => limiter.consume(policy, '+919999999999')).toThrow('Rate limit exceeded for auth.request_otp');
  });

  it('keeps dispatch queue disabled unless explicitly configured', async () => {
    const previous = process.env.DISPATCH_QUEUE_MODE;
    delete process.env.DISPATCH_QUEUE_MODE;
    const queue = new DispatchQueueService();

    await expect(queue.enqueueDelivery('delivery-1')).resolves.toEqual({
      queued: false,
      deliveryId: 'delivery-1',
    });

    process.env.DISPATCH_QUEUE_MODE = previous;
  });
});

const runRedisQueue = process.env.RUN_REDIS_QUEUE_TESTS === 'true' ? describe : describe.skip;

runRedisQueue('Redis/BullMQ dispatch queue', () => {
  it('enqueues dispatch jobs with deterministic IDs against Redis', async () => {
    const previousMode = process.env.DISPATCH_QUEUE_MODE;
    const previousRedisUrl = process.env.REDIS_URL;
    process.env.DISPATCH_QUEUE_MODE = 'bullmq';
    process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:16379';

    const deliveryId = `delivery-${Date.now()}`;
    const assignmentId = `assignment-${Date.now()}`;
    const queue = new DispatchQueueService();

    try {
      const firstDelivery = await queue.enqueueDelivery(deliveryId);
      const duplicateDelivery = await queue.enqueueDelivery(deliveryId);
      const offerTimeout = await queue.enqueueOfferTimeout(assignmentId, 1_000);

      expect(firstDelivery).toEqual(expect.objectContaining({
        queued: true,
        queueName: DISPATCH_DELIVERY_QUEUE,
        jobId: `delivery-${deliveryId}`,
      }));
      expect(duplicateDelivery.jobId).toBe(firstDelivery.jobId);
      expect(offerTimeout).toEqual(expect.objectContaining({
        queued: true,
        queueName: DISPATCH_OFFER_TIMEOUT_QUEUE,
        jobId: `offer-timeout-${assignmentId}`,
      }));
    } finally {
      await queue.onModuleDestroy();
      await removeBullMqJob(DISPATCH_DELIVERY_QUEUE, `delivery-${deliveryId}`);
      await removeBullMqJob(DISPATCH_OFFER_TIMEOUT_QUEUE, `offer-timeout-${assignmentId}`);
      process.env.DISPATCH_QUEUE_MODE = previousMode;
      process.env.REDIS_URL = previousRedisUrl;
    }
  });
});

async function removeBullMqJob(queueName: string, jobId: string) {
  const queue = new Queue(queueName, {
    connection: { url: process.env.REDIS_URL ?? 'redis://localhost:16379' },
  });
  try {
    const job = await queue.getJob(jobId);
    await job?.remove();
  } finally {
    await queue.close();
  }
}
