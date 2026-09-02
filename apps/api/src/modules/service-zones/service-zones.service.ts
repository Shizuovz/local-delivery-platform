import { Injectable } from '@nestjs/common';
import { ServiceZone, User } from '@local-delivery/types';
import { ForbiddenError, NotFoundError } from '../../common/domain-errors';
import { InMemoryStore } from '../../common/in-memory-store';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class ServiceZonesService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly prisma: PrismaService,
  ) {}

  async list(actor?: User) {
    const admin = actor && (actor.roles.includes('OPS_ADMIN') || actor.roles.includes('SUPER_ADMIN'));
    if (this.prisma.isEnabled()) {
      const zones = await this.prisma.serviceZone.findMany({
        where: admin ? {} : { active: true },
        orderBy: [{ city: 'asc' }, { code: 'asc' }],
      });
      return zones.map((zone) => this.toZone(zone));
    }
    return [...this.store.serviceZones.values()].filter((zone) => admin || zone.active);
  }

  async upsert(actor: User, input: Omit<ServiceZone, 'id'> & { reason: string }) {
    this.requireAdmin(actor);
    if (this.prisma.isEnabled()) {
      const zone = await this.prisma.serviceZone.upsert({
        where: { code: input.code },
        update: this.zoneData(input),
        create: { code: input.code, ...this.zoneData(input) },
      });
      await this.prisma.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'admin.service_zone.upsert',
          entityType: 'service_zone',
          entityId: zone.id,
          reason: input.reason,
          metadata: { code: zone.code, active: zone.active, city: zone.city },
        },
      });
      return this.toZone(zone);
    }

    const existing = this.store.serviceZones.get(input.code);
    const zone: ServiceZone = {
      id: existing?.id ?? this.store.createId('zone'),
      code: input.code,
      name: input.name,
      city: input.city,
      active: input.active,
      centerLat: input.centerLat,
      centerLng: input.centerLng,
      radiusKm: input.radiusKm,
    };
    this.store.serviceZones.set(zone.code, zone);
    this.store.writeAudit(actor.id, 'admin.service_zone.upsert', 'service_zone', zone.id, input.reason, {
      code: zone.code,
      active: zone.active,
      city: zone.city,
    });
    return zone;
  }

  async zoneForPair(pickup: { lat: number; lng: number }, drop: { lat: number; lng: number }) {
    const zones = await this.list();
    const zone = zones.find((item) => (
      this.distanceKm(pickup.lat, pickup.lng, item.centerLat, item.centerLng) <= item.radiusKm
      && this.distanceKm(drop.lat, drop.lng, item.centerLat, item.centerLng) <= item.radiusKm
    ));
    if (!zone) throw new ForbiddenError('Pickup and drop must be inside an active service zone');
    return zone;
  }

  zoneForPairFromMemory(pickup: { lat: number; lng: number }, drop: { lat: number; lng: number }) {
    const zone = [...this.store.serviceZones.values()].filter((item) => item.active).find((item) => (
      this.distanceKm(pickup.lat, pickup.lng, item.centerLat, item.centerLng) <= item.radiusKm
      && this.distanceKm(drop.lat, drop.lng, item.centerLat, item.centerLng) <= item.radiusKm
    ));
    if (!zone) throw new ForbiddenError('Pickup and drop must be inside an active service zone');
    return zone;
  }

  private zoneData(input: Omit<ServiceZone, 'id'>) {
    return {
      name: input.name,
      city: input.city,
      active: input.active,
      centerLat: input.centerLat,
      centerLng: input.centerLng,
      radiusKm: input.radiusKm,
    };
  }

  private toZone(zone: {
    id: string;
    code: string;
    name: string;
    city: string;
    active: boolean;
    centerLat: unknown;
    centerLng: unknown;
    radiusKm: unknown;
  }): ServiceZone {
    return {
      id: zone.id,
      code: zone.code,
      name: zone.name,
      city: zone.city,
      active: zone.active,
      centerLat: Number(zone.centerLat),
      centerLng: Number(zone.centerLng),
      radiusKm: Number(zone.radiusKm),
    };
  }

  private distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
    const kmPerDegree = 111;
    const x = (lng2 - lng1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
    const y = lat2 - lat1;
    return Math.sqrt(x * x + y * y) * kmPerDegree;
  }

  private requireAdmin(actor: User) {
    if (!actor.roles.includes('OPS_ADMIN') && !actor.roles.includes('SUPER_ADMIN')) {
      throw new ForbiddenError('Admin role required');
    }
  }
}
