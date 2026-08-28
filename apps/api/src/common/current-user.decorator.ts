import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '@local-delivery/types';

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): User => {
  const request = context.switchToHttp().getRequest();
  return request.user;
});
