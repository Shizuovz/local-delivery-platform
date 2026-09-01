import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ActorService } from './actor.service';
import { CacheService } from './cache.service';
import { DevAuthGuard } from './dev-auth.guard';
import { InMemoryStore } from './in-memory-store';
import { ObjectStorageService } from './object-storage.service';
import { PrismaService } from './prisma.service';
import { PrivateFileRetentionService } from './private-file-retention.service';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitService } from './rate-limit.service';
import { StorageController } from './storage.controller';

@Global()
@Module({
  controllers: [StorageController],
  providers: [
    ActorService,
    CacheService,
    InMemoryStore,
    ObjectStorageService,
    PrivateFileRetentionService,
    PrismaService,
    RateLimitService,
    { provide: APP_GUARD, useClass: DevAuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [ActorService, CacheService, InMemoryStore, ObjectStorageService, PrivateFileRetentionService, PrismaService, RateLimitService],
})
export class CoreModule {}
