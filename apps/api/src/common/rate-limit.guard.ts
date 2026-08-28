import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RATE_LIMIT_POLICY, RateLimitPolicy } from './rate-limit.decorator';
import { RateLimitService } from './rate-limit.service';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: RateLimitService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const policy = this.reflector.getAllAndOverride<RateLimitPolicy>(RATE_LIMIT_POLICY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!policy) return true;

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;
    const ip = request.ip ?? request.socket?.remoteAddress ?? 'unknown';
    const bodyPhone = typeof request.body?.phone === 'string' ? request.body.phone : undefined;
    const subject = userId ?? bodyPhone ?? ip;

    this.limiter.consume(policy, subject);
    return true;
  }
}
