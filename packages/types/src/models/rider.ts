import { RiderAvailabilityStatus } from '../enums/rider-availability-status';

export interface RiderProfile {
  userId: string;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  availabilityStatus: RiderAvailabilityStatus;
  vehicleType: 'BIKE' | 'SCOOTER' | 'CYCLE' | 'CAR';
  activeJobLimit: number;
  suspended: boolean;
}
