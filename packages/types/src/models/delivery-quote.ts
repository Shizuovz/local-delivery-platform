import { DeliveryType } from '../enums/delivery-type';

export interface DeliveryQuote {
  id: string;
  customerId?: string;
  businessId?: string;
  type: DeliveryType;
  pickupAddressId: string;
  dropAddressId: string;
  distanceMeters: number;
  amountMinor: number;
  currency: string;
  expiresAt: string;
  metadata?: Record<string, unknown>;
  pricing: {
    baseFeeMinor: number;
    distanceFeeMinor: number;
    packageFeeMinor: number;
    zoneSurchargeMinor: number;
    platformFeeMinor: number;
    taxMinor: number;
    discountMinor: number;
  };
}
