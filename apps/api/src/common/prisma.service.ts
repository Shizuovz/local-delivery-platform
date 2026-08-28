import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@local-delivery/database';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  isEnabled() {
    return process.env.PERSISTENCE_MODE === 'prisma';
  }

  async onModuleInit() {
    if (this.isEnabled()) {
      await this.$connect();
    }
  }

  async onModuleDestroy() {
    if (this.isEnabled()) {
      await this.$disconnect();
    }
  }

  async isHealthy() {
    if (!this.isEnabled()) {
      return { mode: 'memory', connected: false };
    }

    await this.$queryRaw`SELECT 1`;
    return { mode: 'prisma', connected: true };
  }
}
