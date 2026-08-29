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
