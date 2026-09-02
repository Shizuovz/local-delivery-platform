import { DeliveryType } from '../enums/delivery-type';

export interface PricingRule {
  id: string;
  code: string;
  deliveryType: DeliveryType;
  zoneCode?: string;
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
  createdAt: string;
  updatedAt: string;
}
