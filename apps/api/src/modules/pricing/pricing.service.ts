import { Injectable } from '@nestjs/common';
import { DeliveryType, PricingRule, User } from '@local-delivery/types';
import { ForbiddenError, NotFoundError } from '../../common/domain-errors';
import { InMemoryStore } from '../../common/in-memory-store';
import { PrismaService } from '../../common/prisma.service';

type PackageClass = 'SMALL' | 'MEDIUM' | 'LARGE';
type PricingRuleInput = Omit<PricingRule, 'id' | 'createdAt' | 'updatedAt' | 'deliveryType'> & {
  deliveryType: DeliveryType | 'SEND' | 'BUSINESS_DELIVERY' | 'LIMITED_FETCH';
  reason: string;
};

@Injectable()
export class PricingService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly prisma: PrismaService,
  ) {}

  list(actor: User) {
    this.requireAdmin(actor);
    if (this.prisma.isEnabled()) {
      return this.prisma.pricingRule.findMany({ orderBy: [{ deliveryType: 'asc' }, { code: 'asc' }] });
    }
    return [...this.store.pricingRules.values()];
  }

  async upsert(actor: User, input: PricingRuleInput) {
    this.requireAdmin(actor);
    if (this.prisma.isEnabled()) {
      const rule = await this.prisma.pricingRule.upsert({
        where: { code: input.code },
        update: this.ruleData(input),
        create: { code: input.code, ...this.ruleData(input) },
      });
      await this.prisma.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'admin.pricing_rule.upsert',
          entityType: 'pricing_rule',
          entityId: rule.id,
          reason: input.reason,
          metadata: { code: rule.code, deliveryType: rule.deliveryType, active: rule.active },
        },
      });
      return rule;
    }

    const existing = this.store.pricingRules.get(input.code);
    const now = this.store.now();
    const rule: PricingRule = {
      id: existing?.id ?? this.store.createId('price'),
      code: input.code,
      deliveryType: input.deliveryType as DeliveryType,
      zoneCode: input.zoneCode,
      active: input.active,
      currency: input.currency,
      baseFeeMinor: input.baseFeeMinor,
      perKmFeeMinor: input.perKmFeeMinor,
      mediumPackageFeeMinor: input.mediumPackageFeeMinor,
      largePackageFeeMinor: input.largePackageFeeMinor,
      zoneSurchargeMinor: input.zoneSurchargeMinor,
      platformFeeMinor: input.platformFeeMinor,
      taxBps: input.taxBps,
      discountMinor: input.discountMinor,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.store.pricingRules.set(rule.code, rule);
    this.store.writeAudit(actor.id, 'admin.pricing_rule.upsert', 'pricing_rule', rule.id, input.reason, {
      code: rule.code,
      deliveryType: rule.deliveryType,
      active: rule.active,
    });
    return rule;
  }

  async calculate(input: {
    deliveryType: DeliveryType;
    packageClass: PackageClass;
    distanceMeters: number;
    zoneCode?: string;
  }) {
    const rule = await this.activeRule(input.deliveryType, input.zoneCode);
    const distanceFeeMinor = Math.ceil(input.distanceMeters / 1000) * rule.perKmFeeMinor;
    const packageFeeMinor = input.packageClass === 'LARGE'
      ? rule.largePackageFeeMinor
      : input.packageClass === 'MEDIUM'
        ? rule.mediumPackageFeeMinor
        : 0;
    const subtotalMinor = rule.baseFeeMinor + distanceFeeMinor + packageFeeMinor + rule.zoneSurchargeMinor + rule.platformFeeMinor;
    const taxMinor = Math.round(subtotalMinor * rule.taxBps / 10_000);
    const discountMinor = rule.discountMinor;
    return {
      baseFeeMinor: rule.baseFeeMinor,
      distanceFeeMinor,
      packageFeeMinor,
      zoneSurchargeMinor: rule.zoneSurchargeMinor,
      platformFeeMinor: rule.platformFeeMinor,
      taxMinor,
      discountMinor,
      amountMinor: subtotalMinor + taxMinor - discountMinor,
      currency: rule.currency,
      pricingRuleCode: rule.code,
      zoneCode: input.zoneCode,
    };
  }

  calculateFromMemory(input: {
    deliveryType: DeliveryType;
    packageClass: PackageClass;
    distanceMeters: number;
    zoneCode?: string;
  }) {
    const rules = [...this.store.pricingRules.values()]
      .filter((rule) => rule.deliveryType === input.deliveryType && rule.active)
      .filter((rule) => rule.zoneCode === input.zoneCode || !rule.zoneCode)
      .sort((left, right) => Number(Boolean(right.zoneCode)) - Number(Boolean(left.zoneCode)));
    const rule = rules[0];
    if (!rule) throw new NotFoundError(`No active pricing rule for ${input.deliveryType}`);
    const distanceFeeMinor = Math.ceil(input.distanceMeters / 1000) * rule.perKmFeeMinor;
    const packageFeeMinor = input.packageClass === 'LARGE'
      ? rule.largePackageFeeMinor
      : input.packageClass === 'MEDIUM'
        ? rule.mediumPackageFeeMinor
        : 0;
    const subtotalMinor = rule.baseFeeMinor + distanceFeeMinor + packageFeeMinor + rule.zoneSurchargeMinor + rule.platformFeeMinor;
    const taxMinor = Math.round(subtotalMinor * rule.taxBps / 10_000);
    const discountMinor = rule.discountMinor;
    return {
      baseFeeMinor: rule.baseFeeMinor,
      distanceFeeMinor,
      packageFeeMinor,
      zoneSurchargeMinor: rule.zoneSurchargeMinor,
      platformFeeMinor: rule.platformFeeMinor,
      taxMinor,
      discountMinor,
      amountMinor: subtotalMinor + taxMinor - discountMinor,
      currency: rule.currency,
      pricingRuleCode: rule.code,
      zoneCode: input.zoneCode,
    };
  }

  private async activeRule(deliveryType: DeliveryType, zoneCode?: string): Promise<PricingRule> {
    if (this.prisma.isEnabled()) {
      const zoneRule = zoneCode
        ? await this.prisma.pricingRule.findFirst({
          where: { deliveryType, active: true, zoneCode },
          orderBy: { updatedAt: 'desc' },
        })
        : null;
      const rule = zoneRule ?? await this.prisma.pricingRule.findFirst({
        where: { deliveryType, active: true, zoneCode: null },
        orderBy: { updatedAt: 'desc' },
      });
      if (!rule) throw new NotFoundError(`No active pricing rule for ${deliveryType}`);
      return this.toRule(rule);
    }

    const rules = [...this.store.pricingRules.values()]
      .filter((rule) => rule.deliveryType === deliveryType && rule.active)
      .filter((rule) => rule.zoneCode === zoneCode || !rule.zoneCode)
      .sort((left, right) => Number(Boolean(right.zoneCode)) - Number(Boolean(left.zoneCode)));
    const rule = rules[0];
    if (!rule) throw new NotFoundError(`No active pricing rule for ${deliveryType}`);
    return rule;
  }

  private ruleData(input: PricingRuleInput) {
    return {
      deliveryType: input.deliveryType as DeliveryType,
      zoneCode: input.zoneCode,
      active: input.active,
      currency: input.currency,
      baseFeeMinor: input.baseFeeMinor,
      perKmFeeMinor: input.perKmFeeMinor,
      mediumPackageFeeMinor: input.mediumPackageFeeMinor,
      largePackageFeeMinor: input.largePackageFeeMinor,
      zoneSurchargeMinor: input.zoneSurchargeMinor,
      platformFeeMinor: input.platformFeeMinor,
      taxBps: input.taxBps,
      discountMinor: input.discountMinor,
    };
  }

  private toRule(rule: {
    id: string;
    code: string;
    deliveryType: string;
    zoneCode: string | null;
    active: boolean;
    currency: string;
    baseFeeMinor: number;
    perKmFeeMinor: number;
    mediumPackageFeeMinor: number;
    largePackageFeeMinor: number;
    zoneSurchargeMinor: number;
    platformFeeMinor: number;
    taxBps: number;
    discountMinor: number;
    createdAt: Date;
    updatedAt: Date;
  }): PricingRule {
    return {
      id: rule.id,
      code: rule.code,
      deliveryType: rule.deliveryType as DeliveryType,
      zoneCode: rule.zoneCode ?? undefined,
      active: rule.active,
      currency: rule.currency,
      baseFeeMinor: rule.baseFeeMinor,
      perKmFeeMinor: rule.perKmFeeMinor,
      mediumPackageFeeMinor: rule.mediumPackageFeeMinor,
      largePackageFeeMinor: rule.largePackageFeeMinor,
      zoneSurchargeMinor: rule.zoneSurchargeMinor,
      platformFeeMinor: rule.platformFeeMinor,
      taxBps: rule.taxBps,
      discountMinor: rule.discountMinor,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    };
  }

  private requireAdmin(actor: User) {
    if (!actor.roles.includes('OPS_ADMIN') && !actor.roles.includes('SUPER_ADMIN')) {
      throw new ForbiddenError('Admin role required');
    }
  }
}
