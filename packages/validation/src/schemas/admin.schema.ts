import { z } from 'zod';

export const adminAssignSchema = z.object({
  riderId: z.string().uuid(),
  reason: z.string().min(3),
}).strict();

export const adminReasonSchema = z.object({
  reason: z.string().min(3),
}).strict();

export const adminRiderStatusSchema = z.object({
  approvalStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  suspended: z.boolean().optional(),
  reason: z.string().min(3),
}).strict().refine((value) => value.approvalStatus !== undefined || value.suspended !== undefined, {
  message: 'At least one rider status field is required',
});

export const adminBusinessStatusSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'SUSPENDED']),
  reason: z.string().min(3),
}).strict();

export const adminSupportTicketStatusSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
  reason: z.string().min(3),
}).strict();

export const adminPricingRuleSchema = z.object({
  code: z.string().min(3).max(64).regex(/^[A-Z0-9_-]+$/),
  deliveryType: z.enum(['SEND', 'BUSINESS_DELIVERY', 'LIMITED_FETCH']),
  zoneCode: z.string().min(2).max(64).regex(/^[A-Z0-9_-]+$/).optional(),
  active: z.boolean().default(true),
  currency: z.string().length(3).default('INR'),
  baseFeeMinor: z.number().int().min(0),
  perKmFeeMinor: z.number().int().min(0),
  mediumPackageFeeMinor: z.number().int().min(0).default(2000),
  largePackageFeeMinor: z.number().int().min(0).default(5000),
  zoneSurchargeMinor: z.number().int().min(0).default(0),
  platformFeeMinor: z.number().int().min(0).default(500),
  taxBps: z.number().int().min(0).max(10_000).default(0),
  discountMinor: z.number().int().min(0).default(0),
  reason: z.string().min(3),
}).strict();

export const adminPricingRulePatchSchema = adminPricingRuleSchema.partial().extend({
  reason: z.string().min(3),
}).strict();

export const adminServiceZoneSchema = z.object({
  code: z.string().min(2).max(64).regex(/^[A-Z0-9_-]+$/),
  name: z.string().min(2).max(120),
  city: z.string().min(2).max(80),
  active: z.boolean().default(true),
  centerLat: z.number().min(-90).max(90),
  centerLng: z.number().min(-180).max(180),
  radiusKm: z.number().positive().max(100),
  reason: z.string().min(3),
}).strict();

export const adminServiceZonePatchSchema = adminServiceZoneSchema.partial().extend({
  reason: z.string().min(3),
}).strict();
