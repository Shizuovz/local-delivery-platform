import { Injectable } from '@nestjs/common';
import { ConflictError } from './domain-errors';
import { RateLimitPolicy } from './rate-limit.decorator';

interface Bucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitService {
  private readonly buckets = new Map<string, Bucket>();

  consume(policy: RateLimitPolicy, subject: string) {
    const now = Date.now();
    const key = `${policy.key}:${subject}`;
    const existing = this.buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + policy.windowMs });
      return;
    }

    if (existing.count >= policy.limit) {
      throw new ConflictError(`Rate limit exceeded for ${policy.key}`);
    }

    existing.count += 1;
  }
}
