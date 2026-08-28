export type ProofType = 'PICKUP_REFERENCE' | 'OTP' | 'PHOTO' | 'SIGNATURE' | 'ADMIN_NOTE';

export interface Proof {
  id: string;
  deliveryId: string;
  type: ProofType;
  createdBy: string;
  fileUrl?: string;
  otpVerified?: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
