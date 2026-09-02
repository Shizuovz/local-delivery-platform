import { Body, Controller, Get, Post } from '@nestjs/common';
import { adminPricingRuleSchema } from '@local-delivery/validation';
import { User } from '@local-delivery/types';
import { CurrentUser } from '../../common/current-user.decorator';
import { RateLimit } from '../../common/rate-limit.decorator';
import { PricingService } from './pricing.service';

@Controller('admin/pricing-rules')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Get()
  list(@CurrentUser() actor: User) {
    return this.pricingService.list(actor);
  }

  @Post()
  @RateLimit({ key: 'admin.pricing_rule', limit: 30, windowMs: 60 * 1000 })
  upsert(@CurrentUser() actor: User, @Body() body: unknown) {
    const input = adminPricingRuleSchema.parse(body);
    return this.pricingService.upsert(actor, input);
  }
}
