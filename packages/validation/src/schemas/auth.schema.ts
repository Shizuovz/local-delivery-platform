import { z } from 'zod';

export const requestOtpSchema = z.object({
  phone: z.string().min(8).max(16),
});

export const verifyOtpSchema = z.object({
  phone: z.string().min(8).max(16),
  code: z.string().length(6),
  roleHint: z.enum(['CUSTOMER', 'RIDER', 'BUSINESS', 'OPS_ADMIN']).optional(),
});
