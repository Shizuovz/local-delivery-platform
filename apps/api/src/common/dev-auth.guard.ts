import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ActorService } from './actor.service';
import { ForbiddenError } from './domain-errors';
import { IS_PUBLIC_ROUTE } from './public.decorator';

@Injectable()
export class DevAuthGuard implements CanActivate {
  constructor(
    private readonly actors: ActorService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const userId = request.headers['x-user-id'];
    if (typeof userId !== 'string') {
      throw new ForbiddenError('Missing or invalid x-user-id');
    }

    request.user = await this.actors.requireActor(userId);
    return true;
  }
}
