# API Contract Notes

Status: v1 draft for local build and UI wiring.

Base URL:

```text
http://localhost:4000/api/v1
```

## Auth

Local development uses `x-user-id` as a dev access token after OTP verification.

Public endpoints:

- `POST /auth/request-otp`
- `POST /auth/verify-otp`
- `GET /health`

Protected endpoints require:

```text
x-user-id: <user id>
```

## Error Shape

All runtime errors should return:

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "Delivery already has an accepted assignment"
  },
  "requestId": "optional-client-request-id",
  "timestamp": "2026-08-27T00:00:00.000Z"
}
```

## Customer SEND Endpoints

### Request OTP

```http
POST /auth/request-otp
```

```json
{
  "phone": "+919999999999"
}
```

### Verify OTP

```http
POST /auth/verify-otp
```

```json
{
  "phone": "+919999999999",
  "code": "123456",
  "roleHint": "CUSTOMER"
}
```

### Create Quote

```http
POST /deliveries/quote
```

```json
{
  "type": "SEND",
  "pickupAddress": {
    "line1": "MG Road",
    "city": "Bengaluru",
    "lat": 12.9716,
    "lng": 77.5946
  },
  "dropAddress": {
    "line1": "Indiranagar",
    "city": "Bengaluru",
    "lat": 12.9784,
    "lng": 77.6408
  },
  "item": {
    "description": "Documents",
    "packageClass": "SMALL",
    "quantity": 1
  }
}
```

### Create Delivery

```http
POST /deliveries
```

```json
{
  "quoteId": "quote_uuid",
  "idempotencyKey": "customer-generated-unique-key"
}
```

### Mock Payment Confirm

```http
POST /payments/mock/confirm
```

```json
{
  "paymentId": "payment_uuid",
  "providerEventId": "unique-provider-event-id"
}
```

### Tracking

```http
GET /deliveries/:id/tracking
```

## Rider Endpoints

- `PATCH /rider/availability`
- `POST /rider/location`
- `GET /rider/jobs/offers`
- `POST /rider/jobs/:id/accept`
- `POST /rider/jobs/:id/reject`
- `POST /rider/jobs/:id/arrived-pickup`
- `POST /rider/jobs/:id/picked-up`
- `POST /rider/jobs/:id/arrived-drop`
- `POST /rider/jobs/:id/delivered`
- `GET /rider/earnings`

Delivery completion requires OTP, photo URL, or signature URL.

## Admin Endpoints

- `GET /admin/deliveries`
- `GET /admin/deliveries/:id/timeline`
- `POST /admin/deliveries/:id/assign`
- `POST /admin/deliveries/:id/reassign`
- `GET /admin/audit-logs`

Admin assign/reassign requests must include:

```json
{
  "riderId": "rider_user_uuid",
  "reason": "Manual assignment from admin UI"
}
```

## Current Scope

Implemented for the functional spine:

- Customer `SEND`
- Mock prepaid payment
- Direct dispatch by default
- Redis/BullMQ queued dispatch behind `DISPATCH_QUEUE_MODE=bullmq`
- Rider accept and lifecycle
- Admin delivery board/timeline/manual assignment

Not yet implemented:

- Real payment provider webhook signature verification
- `BUSINESS_DELIVERY`
- `LIMITED_FETCH`
- Full Redis/BullMQ retry/radius expansion/admin-attention policy
- Signed proof/document URLs
