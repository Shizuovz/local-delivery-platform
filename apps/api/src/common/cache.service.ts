import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

interface CacheSetOptions {
  ttlSeconds: number;
}

@Injectable()
export class CacheService implements OnModuleDestroy {
  private client?: Redis;
  private disabledUntil = 0;

  async getJson<T>(key: string): Promise<T | undefined> {
    const client = this.getClient();
    if (!client) return undefined;

    try {
      const value = await client.get(key);
      return value ? JSON.parse(value) as T : undefined;
    } catch {
      this.markUnavailable();
      return undefined;
    }
  }

  async setJson(key: string, value: unknown, options: CacheSetOptions): Promise<void> {
    const client = this.getClient();
    if (!client) return;

    try {
      await client.set(key, JSON.stringify(value), 'EX', options.ttlSeconds);
    } catch {
      this.markUnavailable();
    }
  }

  async delete(key: string): Promise<void> {
    const client = this.getClient();
    if (!client) return;

    try {
      await client.del(key);
    } catch {
      this.markUnavailable();
    }
  }

  async health() {
    if (process.env.CACHE_MODE === 'off') {
      return { mode: 'off', connected: false };
    }
    const client = this.getClient();
    if (!client) return { mode: 'redis', connected: false, degradedUntil: new Date(this.disabledUntil).toISOString() };

    try {
      await client.ping();
      return { mode: 'redis', connected: true };
    } catch {
      this.markUnavailable();
      return { mode: 'redis', connected: false, degradedUntil: new Date(this.disabledUntil).toISOString() };
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      this.client.disconnect();
    }
  }

  private getClient() {
    if (this.disabledUntil > Date.now()) return undefined;
    if (process.env.CACHE_MODE === 'off') return undefined;
    if (!this.client) {
      this.client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:16379', {
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        lazyConnect: true,
      });
      this.client.on('error', () => {
        this.markUnavailable();
      });
    }
    return this.client;
  }

  private markUnavailable() {
    this.disabledUntil = Date.now() + 30_000;
    this.client?.disconnect();
    this.client = undefined;
  }
}
