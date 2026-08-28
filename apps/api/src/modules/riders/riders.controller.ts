import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { deliveryProofSchema, riderAvailabilitySchema, riderLocationSchema } from '@local-delivery/validation';
import { User } from '@local-delivery/types';
import { CurrentUser } from '../../common/current-user.decorator';
import { RateLimit } from '../../common/rate-limit.decorator';
import { RidersService } from './riders.service';

@Controller('rider')
export class RidersController {
  constructor(private readonly ridersService: RidersService) {}

  @Patch('availability')
  @RateLimit({ key: 'rider.availability', limit: 30, windowMs: 60 * 1000 })
  async availability(@CurrentUser() actor: User, @Body() body: unknown) {
    const input = riderAvailabilitySchema.parse(body);
    return this.ridersService.setAvailability(actor, input.online);
  }

  @Post('location')
  @RateLimit({ key: 'rider.location', limit: 120, windowMs: 60 * 1000 })
  async location(@CurrentUser() actor: User, @Body() body: unknown) {
    const input = riderLocationSchema.parse(body);
    return this.ridersService.updateLocation(actor, input.lat, input.lng);
  }

  @Get('jobs/offers')
  async offers(@CurrentUser() actor: User) {
    return this.ridersService.offers(actor);
  }

  @Post('jobs/:id/accept')
  @RateLimit({ key: 'rider.job_accept', limit: 60, windowMs: 60 * 1000 })
  async accept(@CurrentUser() actor: User, @Param('id') id: string) {
    return this.ridersService.accept(actor, id);
  }

  @Post('jobs/:id/reject')
  @RateLimit({ key: 'rider.job_reject', limit: 60, windowMs: 60 * 1000 })
  async reject(@CurrentUser() actor: User, @Param('id') id: string) {
    return this.ridersService.reject(actor, id);
  }

  @Post('jobs/:id/arrived-pickup')
  @RateLimit({ key: 'rider.job_action', limit: 60, windowMs: 60 * 1000 })
  async arrivedPickup(@CurrentUser() actor: User, @Param('id') id: string) {
    return this.ridersService.arrivedPickup(actor, id);
  }

  @Post('jobs/:id/picked-up')
  @RateLimit({ key: 'rider.job_action', limit: 60, windowMs: 60 * 1000 })
  async pickedUp(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: { pickupReference?: string }) {
    return this.ridersService.pickedUp(actor, id, body?.pickupReference);
  }

  @Post('jobs/:id/arrived-drop')
  @RateLimit({ key: 'rider.job_action', limit: 60, windowMs: 60 * 1000 })
  async arrivedDrop(@CurrentUser() actor: User, @Param('id') id: string) {
    return this.ridersService.arrivedDrop(actor, id);
  }

  @Post('jobs/:id/delivered')
  @RateLimit({ key: 'rider.job_action', limit: 60, windowMs: 60 * 1000 })
  async delivered(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const input = deliveryProofSchema.parse(body);
    return this.ridersService.delivered(actor, id, input);
  }

  @Get('earnings')
  async earnings(@CurrentUser() actor: User) {
    return this.ridersService.earnings(actor);
  }
}
