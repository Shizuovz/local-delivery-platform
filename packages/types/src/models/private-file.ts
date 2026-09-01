export interface SignedUpload {
  storageProvider: string;
  bucket: string;
  objectKey: string;
  uploadUrl: string;
  method: 'PUT';
  expiresAt: string;
  headers: Record<string, string>;
}

export interface RiderDocument {
  id: string;
  riderId: string;
  type: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  signedUrl?: string;
  expiresAt?: string;
  retentionExpiresAt?: string;
  createdAt: string;
}
