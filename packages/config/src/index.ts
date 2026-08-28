export const config = {
  apiBaseUrl: process.env.NEXT_PUBLIC_API_URL ?? process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
  otpDevCode: process.env.OTP_DEV_CODE ?? '123456',
  paymentProvider: process.env.PAYMENT_PROVIDER ?? 'mock',
  mapsProvider: process.env.MAPS_PROVIDER ?? 'mock',
};
