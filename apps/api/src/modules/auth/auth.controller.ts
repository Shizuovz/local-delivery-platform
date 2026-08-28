import { Body, Controller, Get, Post } from '@nestjs/common';
import { requestOtpSchema, verifyOtpSchema } from '@local-delivery/validation';
import { CurrentUser } from '../../common/current-user.decorator';
import { Public } from '../../common/public.decorator';
import { RateLimit } from '../../common/rate-limit.decorator';
import { AuthService } from './auth.service';
import { User } from '@local-delivery/types';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('auth/request-otp')
  @Public()
  @RateLimit({ key: 'auth.request_otp', limit: 5, windowMs: 10 * 60 * 1000 })
  requestOtp(@Body() body: unknown) {
    const input = requestOtpSchema.parse(body);
    return this.authService.requestOtp(input.phone);
  }

  @Post('auth/verify-otp')
  @Public()
  @RateLimit({ key: 'auth.verify_otp', limit: 10, windowMs: 10 * 60 * 1000 })
  verifyOtp(@Body() body: unknown) {
    const input = verifyOtpSchema.parse(body);
    return this.authService.verifyOtp(input.phone, input.code, input.roleHint);
  }

  @Get('me')
  me(@CurrentUser() user: User) {
    return user;
  }
}
