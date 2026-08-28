import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { createBusinessDeliverySchema } from '@local-delivery/validation';
import { User } from '@local-delivery/types';
import { CurrentUser } from '../../common/current-user.decorator';
import { RateLimit } from '../../common/rate-limit.decorator';
import { BusinessesService } from './businesses.service';

@Controller('business')
export class BusinessesController {
  constructor(private readonly businessesService: BusinessesService) {}

  @Get('profile')
  async profile(@CurrentUser() actor: User) {
    return this.businessesService.profile(actor);
  }

  @Post('deliveries')
  @RateLimit({ key: 'business.delivery_create', limit: 60, windowMs: 60 * 1000 })
  async createDelivery(@CurrentUser() actor: User, @Body() body: unknown) {
    const input = createBusinessDeliverySchema.parse(body);
    return this.businessesService.createDelivery(actor, input);
  }

  @Get('deliveries')
  async deliveries(@CurrentUser() actor: User, @Query('businessId') businessId?: string) {
    return this.businessesService.listDeliveries(actor, businessId);
  }

  @Get('deliveries/:id')
  async delivery(@CurrentUser() actor: User, @Param('id') id: string) {
    return this.businessesService.getDelivery(actor, id);
  }
}
