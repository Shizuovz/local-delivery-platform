import { z } from 'zod';

export const mockPaymentConfirmSchema = z.object({
  paymentId: z.string().uuid(),
  providerEventId: z.string().min(6),
}).strict();

export const mockPaymentWebhookSchema = z.object({
  providerEventId: z.string().min(6),
  providerRef: z.string().min(6),
  status: z.enum(['PAID', 'FAILED']),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3).default('INR'),
}).strict();

export const razorpayWebhookSchema = z.object({
  id: z.string().optional(),
  event: z.string().min(3),
  created_at: z.number().optional(),
  payload: z.object({
    payment: z.object({
      entity: z.object({
        id: z.string().min(3),
        order_id: z.string().min(3).optional(),
        amount: z.number().int().positive(),
        currency: z.string().length(3).default('INR'),
        status: z.string().optional(),
      }).passthrough(),
    }).optional(),
    refund: z.object({
      entity: z.object({
        id: z.string().min(3),
        payment_id: z.string().min(3).optional(),
        amount: z.number().int().positive(),
        currency: z.string().length(3).default('INR'),
        status: z.string().optional(),
      }).passthrough(),
    }).optional(),
  }).passthrough(),
}).passthrough();

export const adminPaymentReconcileSchema = z.object({
  reason: z.string().min(3),
}).strict();
