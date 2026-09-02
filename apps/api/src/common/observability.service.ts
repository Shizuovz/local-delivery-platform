import { Injectable } from '@nestjs/common';
import { CacheService } from './cache.service';
import { ObjectStorageService } from './object-storage.service';
import { PrismaService } from './prisma.service';
import { DispatchQueueService } from '../modules/dispatch/dispatch.queue';

type DependencyStatus = {
  status: 'ok' | 'degraded' | 'disabled';
  details: Record<string, unknown>;
};

@Injectable()
export class ObservabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly storage: ObjectStorageService,
    private readonly dispatchQueue: DispatchQueueService,
  ) {}

  async health() {
    const dependencies = await this.dependencies();
    const triggers = this.runbookTriggers(dependencies, await this.dispatchQueue.metrics().catch(() => ({ enabled: false, queues: [] })));
    return {
      ok: triggers.every((trigger) => trigger.severity !== 'critical'),
      timestamp: new Date().toISOString(),
      dependencies,
      runbookTriggers: triggers,
    };
  }

  async metrics() {
    const [dependencies, queues] = await Promise.all([
      this.dependencies(),
      this.dispatchQueue.metrics().catch((error) => ({
        enabled: this.dispatchQueue.isEnabled(),
        error: error instanceof Error ? error.message : 'Queue metrics failed',
        queues: [],
      })),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      dependencies,
      queues,
      runbookTriggers: this.runbookTriggers(dependencies, queues),
    };
  }

  private async dependencies() {
    const [postgres, redis, dispatchQueue] = await Promise.all([
      this.status('postgres', () => this.prisma.isHealthy()),
      this.status('redis', () => this.cache.health()),
      this.status('dispatchQueue', () => this.dispatchQueue.isHealthy()),
    ]);
    const storageHealth = this.storage.health();
    const storage: DependencyStatus = {
      status: storageHealth.configured ? 'ok' : 'degraded',
      details: storageHealth,
    };

    return { postgres, redis, storage, dispatchQueue };
  }

  private async status(name: string, probe: () => Promise<Record<string, unknown>>): Promise<DependencyStatus> {
    try {
      const details = await probe();
      if (details['mode'] === 'memory' || details['enabled'] === false || details['mode'] === 'off') {
        return { status: 'disabled', details };
      }
      return details['connected'] === false
        ? { status: 'degraded', details }
        : { status: 'ok', details };
    } catch (error) {
      return {
        status: 'degraded',
        details: {
          name,
          error: error instanceof Error ? error.message : 'Health probe failed',
        },
      };
    }
  }

  private runbookTriggers(
    dependencies: Record<string, DependencyStatus>,
    queueMetrics: { queues?: Array<{ name: string; failed?: number; waiting?: number; delayed?: number }> },
  ) {
    const triggers: Array<{ key: string; severity: 'warning' | 'critical'; runbook: string; message: string }> = [];
    if (dependencies.postgres?.status === 'degraded') {
      triggers.push({
        key: 'postgres.unreachable',
        severity: 'critical',
        runbook: 'docs/runbooks/local-functional-spine.md',
        message: 'PostgreSQL is unavailable or failing health checks.',
      });
    }
    if (dependencies.redis?.status === 'degraded' || dependencies.dispatchQueue?.status === 'degraded') {
      triggers.push({
        key: 'redis.queue.degraded',
        severity: 'warning',
        runbook: 'docs/runbooks/dispatch-recovery.md',
        message: 'Redis or BullMQ dispatch queues are degraded.',
      });
    }
    if (dependencies.storage?.status === 'degraded') {
      triggers.push({
        key: 'storage.degraded',
        severity: 'warning',
        runbook: 'docs/runbooks/storage-operations.md',
        message: 'Object storage is not fully configured.',
      });
    }
    for (const queue of queueMetrics.queues ?? []) {
      if ((queue.failed ?? 0) > 0) {
        triggers.push({
          key: `queue.${queue.name}.failed`,
          severity: 'warning',
          runbook: 'docs/runbooks/dispatch-recovery.md',
          message: `${queue.name} has failed jobs.`,
        });
      }
      if ((queue.waiting ?? 0) + (queue.delayed ?? 0) > 50) {
        triggers.push({
          key: `queue.${queue.name}.backlog`,
          severity: 'warning',
          runbook: 'docs/runbooks/dispatch-recovery.md',
          message: `${queue.name} backlog is above the local alert threshold.`,
        });
      }
    }
    return triggers;
  }
}
