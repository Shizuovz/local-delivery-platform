import { AssignmentStatus } from '../enums/assignment-status';

export interface Assignment {
  id: string;
  deliveryId: string;
  riderId: string;
  status: AssignmentStatus;
  offeredAt: string;
  expiresAt?: string;
  acceptedAt?: string;
}
