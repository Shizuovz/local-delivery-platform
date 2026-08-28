import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  Assignment,
  AssignmentStatus,
  AuditLog,
  Delivery,
  DeliveryItem,
  DeliveryQuote,
  DeliveryStatus,
  DeliveryType,
  Payment,
  PaymentStatus,
  Proof,
  RiderAvailabilityStatus,
  RiderLocation,
  RiderProfile,
  SupportTicket,
  User,
  UserRole,
} from '@local-delivery/types';

export interface DeliveryStatusEvent {
  id: string;
  deliveryId: string;
  status: DeliveryStatus;
  actorId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

@Injectable()
export class InMemoryStore {
  readonly users = new Map<string, User>();
  readonly usersByPhone = new Map<string, string>();
  readonly riders = new Map<string, RiderProfile>();
  readonly locations = new Map<string, RiderLocation>();
  readonly quotes = new Map<string, DeliveryQuote>();
  readonly deliveries = new Map<string, Delivery>();
  readonly deliveryItems = new Map<string, DeliveryItem>();
  readonly deliveryIdempotency = new Map<string, string>();
  readonly payments = new Map<string, Payment>();
  readonly paymentEvents = new Set<string>();
  readonly assignments = new Map<string, Assignment>();
  readonly proofs = new Map<string, Proof>();
  readonly supportTickets = new Map<string, SupportTicket>();
  readonly history: DeliveryStatusEvent[] = [];
  readonly auditLogs: AuditLog[] = [];

  constructor() {
    this.seed();
  }

  createId(prefix: string): string {
    void prefix;
    return randomUUID();
  }

  now(): string {
    return new Date().toISOString();
  }

  writeHistory(deliveryId: string, status: DeliveryStatus, actorId?: string, reason?: string, metadata?: Record<string, unknown>) {
    this.history.push({
      id: this.createId('hist'),
      deliveryId,
      status,
      actorId,
      reason,
      metadata,
      timestamp: this.now(),
    });
  }

  writeAudit(actorId: string, action: string, entityType: string, entityId: string, reason?: string, metadata?: Record<string, unknown>) {
    this.auditLogs.push({
      id: this.createId('audit'),
      actorId,
      action,
      entityType,
      entityId,
      reason,
      metadata,
      createdAt: this.now(),
    });
  }

  getUser(id: string): User | undefined {
    return this.users.get(id);
  }

  findOrCreateUser(phone: string, roles: UserRole[]): User {
    const existingId = this.usersByPhone.get(phone);
    if (existingId) {
      return this.users.get(existingId)!;
    }

    const user: User = {
      id: this.createId('usr'),
      phone,
      status: 'ACTIVE',
      roles,
      createdAt: this.now(),
    };

    this.users.set(user.id, user);
    this.usersByPhone.set(phone, user.id);
    return user;
  }

  seed() {
    const admin = this.findOrCreateUser('+910000000001', ['OPS_ADMIN', 'SUPER_ADMIN']);
    admin.name = 'Ops Admin';

    const riderUser = this.findOrCreateUser('+910000000002', ['RIDER']);
    riderUser.name = 'Demo Rider';
    this.riders.set(riderUser.id, {
      userId: riderUser.id,
      approvalStatus: 'APPROVED',
      availabilityStatus: RiderAvailabilityStatus.ONLINE_IDLE,
      vehicleType: 'BIKE',
      activeJobLimit: 1,
      suspended: false,
    });
    this.locations.set(riderUser.id, {
      riderId: riderUser.id,
      lat: 12.9716,
      lng: 77.5946,
      recordedAt: this.now(),
    });
  }

  roleForDevToken(token?: string): UserRole {
    if (token === 'rider') return 'RIDER';
    if (token === 'admin') return 'OPS_ADMIN';
    return 'CUSTOMER';
  }
}
