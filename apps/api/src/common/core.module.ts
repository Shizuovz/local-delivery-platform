import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ActorService } from './actor.service';
import { DevAuthGuard } from './dev-auth.guard';
import { InMemoryStore } from './in-memory-store';
import { PrismaService } from './prisma.service';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitService } from './rate-limit.service';

@Global()
@Module({
  providers: [
    ActorService,
    InMemoryStore,
    PrismaService,
    RateLimitService,
    { provide: APP_GUARD, useClass: DevAuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [ActorService, InMemoryStore, PrismaService, RateLimitService],
})
export class CoreModule {}
