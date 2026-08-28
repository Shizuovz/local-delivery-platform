import { Body, Controller, Post } from '@nestjs/common';
import { dispatchNowSchema } from '@local-delivery/validation';
import { User } from '@local-delivery/types';
import { CurrentUser } from '../../common/current-user.decorator';
import { ForbiddenError } from '../../common/domain-errors';
import { DispatchService } from './dispatch.service';

@Controller('internal/dispatch')
export class DispatchController {
  constructor(private readonly dispatchService: DispatchService) {}

  @Post('now')
  dispatchNow(@CurrentUser() actor: User, @Body() body: unknown) {
    if (!actor.roles.includes('OPS_ADMIN') && !actor.roles.includes('SUPER_ADMIN')) {
      throw new ForbiddenError('Admin role required');
    }
    const input = dispatchNowSchema.parse(body);
    return this.dispatchService.dispatchDelivery(input.deliveryId);
  }
}
