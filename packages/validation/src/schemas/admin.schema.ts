import { z } from 'zod';

export const adminAssignSchema = z.object({
  riderId: z.string().uuid(),
  reason: z.string().min(3),
});
