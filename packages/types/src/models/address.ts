export interface Address {
  id: string;
  label?: string;
  line1: string;
  city: string;
  lat: number;
  lng: number;
  zoneId?: string;
  metadata?: Record<string, unknown>;
}
