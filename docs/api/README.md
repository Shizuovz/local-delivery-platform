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
- `POST /payments/webhooks/mock`
- `GET /proofs/:id/file`
- `PUT /storage/mock-upload`
- `GET /health`
- `GET /health/ready`
- `GET /health/metrics`

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

## Health And Observability

```http
GET /health
GET /health/ready
GET /health/metrics
```

Health responses include dependency status for PostgreSQL, Redis/cache, object storage, and dispatch queues. Metrics responses include queue counts and runbook trigger keys such as `postgres.unreachable`, `redis.queue.degraded`, `storage.degraded`, queue failures, and queue backlog.

API requests emit structured JSON logs with request ID, method, path, status code, and latency. Worker jobs emit structured JSON logs for start, completion, failure, and worker errors.

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

### Mock Payment Webhook

```http
POST /payments/webhooks/mock
x-mock-payment-signature: dev-mock-payment-secret
```

```json
{
  "providerEventId": "unique-provider-event-id",
  "providerRef": "mock_delivery_uuid",
  "status": "PAID",
  "amountMinor": 8500,
  "currency": "INR"
}
```

The mock webhook is public from the auth guard perspective but must include the mock signature header. Duplicate `providerEventId` values are idempotent.

### Tracking

```http
GET /deliveries/:id/tracking
```

### Proof Metadata

```http
GET /deliveries/:id/proof
```

Returns sanitized proof records for the authenticated delivery owner, assigned rider, business owner, or admin. Raw private file references are not returned. Proof file records include a short-lived `signedUrl` when file access is available.

### Signed Proof File Access

```http
GET /proofs/:id/file?expires=<unix_ms>&token=<signature>
```

The signed proof file endpoint is public from the auth guard perspective because the signed URL itself is the access token. Clients should first request proof metadata through an authorized delivery endpoint, then use the returned `signedUrl`. Local development returns private-file metadata instead of streaming a real S3 object.

### Signed Proof Upload URL

```http
POST /proofs/upload-url
```

```json
{
  "deliveryId": "delivery_uuid",
  "type": "PHOTO",
  "fileName": "drop-proof.jpg",
  "contentType": "image/jpeg"
}
```

Returns a private object key and short-lived signed `PUT` upload URL. Proof object keys use:

```text
private/proofs/<deliveryId>/<uuid>-<safe-file-name>
```

Clients upload to the signed URL, then submit the returned object key as `photoObjectKey` or `signatureObjectKey` during the rider proof action.

### Local Mock Upload

```http
PUT /storage/mock-upload?key=<objectKey>&contentType=<contentType>&expires=<unix_ms>&token=<signature>
```

Local development verifies the upload signature and returns stored-object metadata. When `OBJECT_STORAGE_PROVIDER=s3-compatible` or `OBJECT_STORAGE_PROVIDER=s3` is configured with endpoint, bucket, and credentials, this same API returns provider-generated pre-signed URLs without changing the client proof flow.

## Rider Endpoints

- `PATCH /rider/availability`
- `POST /rider/location`
- `GET /rider/documents`
- `POST /rider/documents/upload-url`
- `GET /rider/documents/:id/file`
- `GET /rider/jobs/offers`
- `POST /rider/jobs/:id/accept`
- `POST /rider/jobs/:id/reject`
- `POST /rider/jobs/:id/arrived-pickup`
- `POST /rider/jobs/:id/picked-up`
- `POST /rider/jobs/:id/arrived-drop`
- `POST /rider/jobs/:id/delivered`
- `GET /rider/earnings`

Delivery completion requires OTP, `photoObjectKey`, `signatureObjectKey`, photo URL, or signature URL. New clients should use private object keys instead of public URLs.

Rider document upload URL requests:

```json
{
  "type": "DRIVING_LICENSE",
  "fileName": "license.pdf",
  "contentType": "application/pdf"
}
```

Rider document object keys use:

```text
private/rider-documents/<riderId>/<uuid>-<safe-file-name>
```

Rider document list responses return sanitized metadata and a short-lived signed read URL. Raw object keys are not returned.

## Admin Endpoints

- `GET /admin/deliveries`
- `GET /admin/deliveries/:id/timeline`
- `POST /admin/deliveries/:id/assign`
- `POST /admin/deliveries/:id/reassign`
- `POST /admin/deliveries/:id/cancel`
- `POST /admin/deliveries/:id/mark-exception`
- `POST /admin/riders/:id/approve`
- `GET /admin/riders/:id/documents`
- `PATCH /admin/riders/:id/status`
- `PATCH /admin/businesses/:id/status`
- `GET /admin/support/tickets`
- `PATCH /admin/support/tickets/:id`
- `GET /admin/audit-logs`
- `GET /admin/reports/operations`
- `GET /admin/pricing-rules`
- `POST /admin/pricing-rules`
- `GET /admin/service-zones`
- `POST /admin/service-zones`

Public serviceability endpoint:

- `GET /service-zones`

Admin assign/reassign requests must include:

```json
{
  "riderId": "rider_user_uuid",
  "reason": "Manual assignment from admin UI"
}
```

Admin cancellation, exception, approval, suspension, and support-ticket updates must include a reason:

```json
{
  "reason": "Operational recovery note"
}
```

Admin rider status updates accept:

```json
{
  "approvalStatus": "APPROVED",
  "suspended": false,
  "reason": "Documents verified"
}
```

Admin business status updates accept:

```json
{
  "status": "SUSPENDED",
  "reason": "Compliance review"
}
```

Support-ticket updates accept:

```json
{
  "status": "RESOLVED",
  "reason": "Customer confirmed address"
}
```

Admin pricing rule upsert requests accept:

```json
{
  "code": "DEFAULT-SEND",
  "deliveryType": "SEND",
  "active": true,
  "currency": "INR",
  "baseFeeMinor": 3000,
  "perKmFeeMinor": 1000,
  "mediumPackageFeeMinor": 2000,
  "largePackageFeeMinor": 5000,
  "zoneSurchargeMinor": 0,
  "platformFeeMinor": 500,
  "taxBps": 0,
  "discountMinor": 0,
  "reason": "Update default SEND pricing"
}
```

Zone-specific pricing rules may include `zoneCode`. New quotes use the active zone-specific rule first, then fall back to the active default rule for that delivery type. Existing quote snapshots are not recalculated after pricing edits.

Admin service-zone upsert requests accept:

```json
{
  "code": "BLR-CENTRAL",
  "name": "Bengaluru Central",
  "city": "Bengaluru",
  "active": true,
  "centerLat": 12.9716,
  "centerLng": 77.5946,
  "radiusKm": 12,
  "reason": "Adjust launch service zone"
}
```

Quote creation validates pickup and drop coordinates against active service zones before pricing. Service-zone and pricing edits require an admin role and create audit logs.

### Operations Report

```http
GET /admin/reports/operations
```

Returns short-lived cached operational counts for the admin dashboard. PostgreSQL remains the source of truth; Redis cache is an optimization only.

```json
{
  "generatedAt": "2026-09-01T00:00:00.000Z",
  "cache": {
    "key": "cache:v1:admin:operations-report",
    "ttlSeconds": 15,
    "hit": false
  },
  "deliveryCounts": {
    "active": 4,
    "searchingRider": 1,
    "assigned": 2,
    "deliveredToday": 8,
    "cancelledToday": 1,
    "failedOrDisputed": 0
  },
  "paymentCounts": {
    "refundPending": 1,
    "paid": 12,
    "failed": 0
  },
  "supportCounts": {
    "open": 1,
    "inProgress": 2,
    "closedToday": 3
  },
  "dispatchCounts": {
    "adminAttention": 4,
    "unassignedSearching": 1,
    "staleSearching": 1
  }
}
```

## Current Scope

Implemented for the functional spine:

- Customer `SEND`
- Customer `LIMITED_FETCH`
- Business `BUSINESS_DELIVERY`
- Mock prepaid payment confirm
- Signed mock payment webhook handling
- Idempotent payment event storage
- Basic cancellation/refund reconciliation
- Direct dispatch by default
- Redis/BullMQ queued dispatch behind `DISPATCH_QUEUE_MODE=bullmq`
- Rider accept and lifecycle
- Admin delivery board/timeline/manual assignment
- Admin cancellation with refund reconciliation
- Admin rider approval/suspension controls
- Admin business approval/suspension controls
- Admin support-ticket list/status controls
- Sanitized proof metadata with short-lived signed file URLs
- Cache policy and Redis-backed admin operations report
- Admin dashboard operations metrics
- Admin-managed pricing rules with audited changes
- Admin-managed service zones with public active-zone listing
- S3-compatible private object key abstraction with local mock signed uploads
- Provider-backed S3-compatible pre-signed upload/read URLs
- Signed proof upload URL endpoint
- Signed rider document URLs for rider/admin views
- Proof and rider document retention cleanup service/job
- Structured API request logs with request IDs and latency
- Health and metrics endpoints for Postgres, Redis/cache, storage, and dispatch queues
- Queue failure/backlog visibility with runbook trigger keys

Not yet implemented:

- Real payment provider integration
- Real provider refund API calls
- Full admin report exports and payment/refund monitoring screens
- Final storage provider selection and bucket/CORS policy
- Optional server-side file proxy/streaming for clients that cannot consume provider URLs directly
- External alert delivery integration such as Sentry/Datadog/PagerDuty
