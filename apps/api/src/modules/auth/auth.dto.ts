export interface RequestOtpDto {
  phone: string;
}

export interface VerifyOtpDto {
  phone: string;
  code: string;
  roleHint?: 'CUSTOMER' | 'RIDER' | 'BUSINESS' | 'OPS_ADMIN';
}
