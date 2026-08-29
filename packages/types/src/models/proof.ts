export type ProofType = 'PICKUP_REFERENCE' | 'OTP' | 'PHOTO' | 'SIGNATURE' | 'ADMIN_NOTE';

export interface Proof {
  id: string;
  deliveryId: string;
  type: ProofType;
  createdBy: string;
  fileUrl?: string;
  signedUrl?: string;
  otpVerified?: boolean;
  metadata?: Record<string, unknown>;
  retentionExpiresAt?: string;
  createdAt: string;
}
