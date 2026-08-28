import { SetMetadata } from '@nestjs/common';

export interface RateLimitPolicy {
  key: string;
  limit: number;
  windowMs: number;
}

export const RATE_LIMIT_POLICY = 'rateLimitPolicy';

export const RateLimit = (policy: RateLimitPolicy) => SetMetadata(RATE_LIMIT_POLICY, policy);
