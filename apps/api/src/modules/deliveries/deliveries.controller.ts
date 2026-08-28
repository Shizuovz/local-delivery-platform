import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { cancelDeliverySchema, createDeliverySchema, quoteDeliverySchema } from '@local-delivery/validation';
import { User } from '@local-delivery/types';
import { CurrentUser } from '../../common/current-user.decorator';
import { RateLimit } from '../../common/rate-limit.decorator';
import { DeliveriesService } from './deliveries.service';

@Controller('deliveries')
export class DeliveriesController {
  constructor(private readonly deliveriesService: DeliveriesService) {}

  @Post('quote')
  @RateLimit({ key: 'deliveries.quote', limit: 30, windowMs: 60 * 1000 })
  async quote(@CurrentUser() actor: User, @Body() body: unknown) {
    const input = quoteDeliverySchema.parse(body);
    return this.deliveriesService.createQuote(actor, input);
  }

  @Post()
  @RateLimit({ key: 'deliveries.create', limit: 20, windowMs: 60 * 1000 })
  async create(@CurrentUser() actor: User, @Body() body: unknown) {
    const input = createDeliverySchema.parse(body);
    return this.deliveriesService.createDelivery(actor, input);
  }

  @Get()
  async list(@CurrentUser() actor: User) {
    return this.deliveriesService.listForActor(actor);
  }

  @Get(':id')
  async get(@CurrentUser() actor: User, @Param('id') id: string) {
    return this.deliveriesService.getDeliveryForActor(actor, id);
  }

  @Get(':id/tracking')
  async tracking(@CurrentUser() actor: User, @Param('id') id: string) {
    return this.deliveriesService.trackingForActor(actor, id);
  }

  @Get(':id/proof')
  async proof(@CurrentUser() actor: User, @Param('id') id: string) {
    const detail = await this.deliveriesService.getDeliveryForActor(actor, id);
    return detail.proofs;
  }

  @Post(':id/cancel')
  @RateLimit({ key: 'deliveries.cancel', limit: 20, windowMs: 60 * 1000 })
  async cancel(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const input = cancelDeliverySchema.parse(body);
    return this.deliveriesService.cancel(actor, id, input.reason);
  }
}
