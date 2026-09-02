import { ArgumentsHost } from '@nestjs/common';
import { Queue } from 'bullmq';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { ConflictError } from './common/domain-errors';
import { ObjectStorageService } from './common/object-storage.service';
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

  it('uses local mock storage URLs unless S3-compatible storage is configured', async () => {
    const previousProvider = process.env.OBJECT_STORAGE_PROVIDER;
    delete process.env.OBJECT_STORAGE_PROVIDER;

    const storage = new ObjectStorageService();
    const upload = await storage.createSignedUpload({
      scope: 'proofs',
      ownerId: 'delivery-1',
      fileName: 'proof.jpg',
      contentType: 'image/jpeg',
    });

    expect(upload.storageProvider).toBe('mock-s3-compatible');
    expect(upload.uploadUrl).toContain('/api/v1/storage/mock-upload');
    expect(storage.verifyUploadUrl(upload.objectKey, 'image/jpeg', Date.parse(upload.expiresAt), new URL(upload.uploadUrl, 'http://localhost').searchParams.get('token') ?? undefined)).toBe(true);

    process.env.OBJECT_STORAGE_PROVIDER = previousProvider;
  });

  it('creates provider-backed S3-compatible presigned upload and read URLs', async () => {
    const previous = {
      provider: process.env.OBJECT_STORAGE_PROVIDER,
      endpoint: process.env.OBJECT_STORAGE_ENDPOINT,
      bucket: process.env.OBJECT_STORAGE_BUCKET,
      accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID,
      secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY,
      region: process.env.OBJECT_STORAGE_REGION,
    };
    process.env.OBJECT_STORAGE_PROVIDER = 's3-compatible';
    process.env.OBJECT_STORAGE_ENDPOINT = 'http://localhost:9000';
    process.env.OBJECT_STORAGE_BUCKET = 'private-test-bucket';
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = 'test-access-key';
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = 'test-secret-key';
    process.env.OBJECT_STORAGE_REGION = 'us-east-1';

    try {
      const storage = new ObjectStorageService();
      const upload = await storage.createSignedUpload({
        scope: 'rider-documents',
        ownerId: 'rider-1',
        fileName: 'license.pdf',
        contentType: 'application/pdf',
      });
      const read = await storage.createSignedRead(upload.objectKey);

      expect(upload.storageProvider).toBe('s3-compatible');
      expect(upload.bucket).toBe('private-test-bucket');
      expect(upload.objectKey).toMatch(/^private\/rider-documents\/rider-1\/.+-license\.pdf$/);
      expect(upload.uploadUrl).toContain('X-Amz-Signature=');
      expect(upload.uploadUrl).toContain('private-test-bucket');
      expect(read?.readUrl).toContain('X-Amz-Signature=');
      expect(read?.objectKey).toBe(upload.objectKey);
    } finally {
      process.env.OBJECT_STORAGE_PROVIDER = previous.provider;
      process.env.OBJECT_STORAGE_ENDPOINT = previous.endpoint;
      process.env.OBJECT_STORAGE_BUCKET = previous.bucket;
      process.env.OBJECT_STORAGE_ACCESS_KEY_ID = previous.accessKeyId;
      process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = previous.secretAccessKey;
      process.env.OBJECT_STORAGE_REGION = previous.region;
    }
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
