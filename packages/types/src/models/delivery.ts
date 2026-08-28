import { DeliveryStatus } from '../enums/delivery-status';
import { DeliveryType } from '../enums/delivery-type';

export interface Delivery {
  id: string;
  type: DeliveryType;
  status: DeliveryStatus;
  customerId?: string;
  businessId?: string;
  quoteId: string;
  pickupAddressId: string;
  dropAddressId: string;
  paymentId?: string;
  assignedRiderId?: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}
