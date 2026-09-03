# Project Specs

Last updated: 2026-09-02

This file describes the current practical build contract for the local delivery platform. It should stay aligned with `architecture-essentials.md`, `architecture.md`, `system-design.md`, `PRD.md`, and `docs/api/README.md`.

## Product Scope

V1 delivery types:

- `SEND`: customer sends an item from pickup to drop.
- `BUSINESS_DELIVERY`: approved business creates a delivery for a customer.
- `LIMITED_FETCH`: customer requests pickup from a known source where item/payment are already arranged.

Excluded from v1:

- rider-funded purchases
- food marketplace
- shop discovery
- product catalog
- inventory management
- product substitution
- wallet
- dark stores
- route optimization

## Stack Spec

- Backend: NestJS + TypeScript modular monolith.
- Database: PostgreSQL + Prisma.
- Queue/cache: Redis + BullMQ.
- Admin web: Next.js + TypeScript.
- Business web: Next.js + TypeScript.
- Customer mobile: React Native + Expo.
- Rider mobile: React Native + Expo.
- Storage target: S3-compatible object storage.
- Payment target: Razorpay or equivalent.
- Maps target: Google Maps Platform or Mapbox.
- Notifications target: FCM plus SMS/WhatsApp for critical events.

## Runtime Modes

Default fast local mode:

- API may run in in-memory persistence for quick tests.
- Dispatch may run inline.

Prisma/PostgreSQL mode:

- `PERSISTENCE_MODE=prisma`
- `DATABASE_URL=postgresql://postgres:postgres@localhost:15432/local_delivery`
- PostgreSQL is the source of truth.

Queued dispatch mode:

- `DISPATCH_QUEUE_MODE=bullmq`
- `REDIS_URL=redis://localhost:16379`
- BullMQ handles dispatch jobs.
- Workers reload state from PostgreSQL before acting.

## Core APIs

Base path:

```text
/api/v1
```

Auth/session:

- `POST /auth/request-otp`
- `POST /auth/verify-otp`
- `GET /me`

Customer delivery:

- `POST /deliveries/quote`
- `POST /deliveries`
- `GET /deliveries`
- `GET /deliveries/:id`
- `GET /deliveries/:id/tracking`
- `GET /deliveries/:id/proof`
- `POST /deliveries/:id/cancel`

Payment:

- `POST /payments/mock/confirm`
- `POST /payments/webhooks/mock`
- `POST /payments/webhooks/razorpay`

Rider:

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

Business:

- `GET /business/profile`
- `POST /business/deliveries`
- `GET /business/deliveries`
- `GET /business/deliveries/:id`
- `GET /business/reports/deliveries`

Admin:

- `GET /admin/deliveries`
- `GET /admin/deliveries/:id/timeline`
- `POST /admin/deliveries/:id/assign`
- `POST /admin/deliveries/:id/reassign`
- `POST /admin/deliveries/:id/cancel`
- `POST /admin/deliveries/:id/mark-exception`
- `POST /admin/riders/:id/approve`
- `PATCH /admin/riders/:id/status`
- `PATCH /admin/businesses/:id/status`
- `GET /admin/support/tickets`
- `PATCH /admin/support/tickets/:id`
- `GET /admin/audit-logs`
- `GET /admin/reports/operations`
- `GET /admin/payments`
- `POST /admin/payments/:id/reconcile`
- `GET /admin/pricing-rules`
- `POST /admin/pricing-rules`
- `GET /admin/service-zones`
- `POST /admin/service-zones`

Public config:

- `GET /service-zones`

Proof file access:

- `GET /proofs/:id/file?expires=<unix_ms>&token=<signature>`

## State Specs

Delivery states:

```text
DRAFT
QUOTED
CONFIRMED
SEARCHING_RIDER
RIDER_ASSIGNED
EN_ROUTE_PICKUP
ARRIVED_PICKUP
PICKED_UP
EN_ROUTE_DROP
ARRIVED_DROP
DELIVERED
CANCELLED
FAILED
RETURN_REQUIRED
RETURNED
DISPUTED
```

Assignment states:

```text
PENDING_OFFER
OFFERED
ACCEPTED
REJECTED
EXPIRED
CANCELLED
REASSIGNED
```

Payment states:

```text
CREATED
PENDING
PAID
FAILED
REFUND_PENDING
PARTIALLY_REFUNDED
REFUNDED
```

Refund states:

```text
REQUESTED
APPROVED
PROCESSING
SUCCEEDED
FAILED
CANCELLED
```

## Data Specs

Required data rules:

- Public IDs use UUIDs.
- Money uses integer minor units.
- Quote snapshots are immutable after confirmation.
- Important delivery transitions create status history.
- Financial events are idempotent.
- Admin, financial, proof, and sensitive state changes create audit logs.
- One accepted assignment per delivery is enforced in the database.
- Proof responses expose sanitized metadata, not raw private file references.
- Proof file reads use short-lived signed URLs.
- New quotes use active admin-managed pricing rules.
- Pickup and drop coordinates must fall inside an active admin-managed service zone.
- Pricing and service-zone admin edits require a reason and create audit logs.
- Payment provider order creation is backend-owned.
- Razorpay webhooks require raw-body HMAC signature verification.
- Provider payment/refund events are stored in `payment_transactions`.
- Admin payment reconciliation writes transaction and audit records.

Important tables:

- `users`
- `roles`
- `user_roles`
- `rider_profiles`
- `rider_documents`
- `businesses`
- `addresses`
- `service_zones`
- `deliveries`
- `delivery_items`
- `delivery_quotes`
- `delivery_status_history`
- `assignments`
- `rider_locations`
- `proofs`
- `payments`
- `payment_transactions`
- `refunds`
- `rider_earnings`
- `business_settlements`
- `notifications`
- `support_tickets`
- `audit_logs`

## Workflow Specs

### Customer SEND

1. Customer verifies OTP.
2. Customer creates quote.
3. Customer creates delivery from quote with idempotency key.
4. Backend creates payment in pending state.
5. Mock or real provider confirms payment.
6. Backend marks payment paid and dispatches delivery.
7. Rider accepts offer.
8. Rider completes pickup and drop lifecycle.
9. Required proof is submitted.
10. Delivery becomes `DELIVERED`.
11. Customer can view tracking and proof.

### Business Delivery

1. Business user verifies OTP.
2. Backend verifies approved business account.
3. Business creates delivery.
4. Backend applies business billing mode.
5. Delivery enters dispatch.
6. Business can list and view its own deliveries.

### Limited Fetch

1. Customer confirms pickup source is known.
2. Customer confirms item is already paid or no payment is needed.
3. Customer provides pickup reference or instructions.
4. Rider only collects and delivers.
5. Rider does not buy, negotiate, substitute, or validate regulated goods.

### Rider Job

1. Rider is approved and not suspended.
2. Rider goes online.
3. Rider sends fresh location.
4. Backend offers eligible job.
5. Rider accepts or rejects.
6. Rider progresses through allowed lifecycle actions.
7. Rider submits required proof.
8. Backend creates earning record after completion where applicable.

### Admin Operations

1. Admin loads delivery board.
2. Admin views timeline.
3. Admin assigns or reassigns rider with reason.
4. Admin marks exceptions with reason.
5. Admin cancels delivery with reason.
6. Backend reconciles refund state where applicable.
7. Admin updates support tickets.
8. Sensitive actions create audit logs.

## Security Specs

- OTP endpoints are rate-limited.
- Protected endpoints require authenticated actor context.
- Role-based authorization is required.
- Object-level authorization is required.
- Webhook simulation requires mock signature; real provider webhook must verify provider signature.
- Clients cannot fake payment success.
- Clients cannot bypass proof requirements.
- Private proof/document URLs are not stored as public client-facing URLs.
- Sensitive fields should be minimized and masked where possible.

## Current Verification Specs

Recently verified:

- `npm run typecheck`
- `npm run lint`
- `npm --workspace apps/api run test`
- Prisma/PostgreSQL API health.
- Business UI create/detail workflow.
- Admin UI assign/reassign/exception/cancel/refund/support workflow.
- Customer mobile API quote/create/pay/track/proof workflow.
- Rider mobile API offer/accept/lifecycle/proof/earnings workflow.

## Local Development Specs

Start dependencies:

```bash
docker compose up -d postgres redis
```

Generate/push/seed:

```bash
npm run db:generate
npm run db:push
npm run db:seed
```

Reset local database:

```bash
npm run db:reset
```

Run API:

```bash
$env:PERSISTENCE_MODE="prisma"
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:15432/local_delivery"
$env:REDIS_URL="redis://localhost:16379"
npm run dev:api
```

Run web apps:

```bash
npm run dev:admin
npm run dev:business
```

## Current Reporting And Cache Spec

The current reporting and cache foundation includes:

- `docs/policies/cache-policy.md`
- Redis cache helper behavior
- cache TTL matrix
- cache invalidation rules
- no-cache rules for sensitive or correctness-critical data
- `GET /api/v1/admin/reports/operations`
- admin dashboard metrics wired to real API data

Current storage foundation includes:

- S3-compatible private object key abstraction
- signed proof upload URL endpoint
- signed rider document upload/list/read URLs
- local mock signed upload route
- proof/document retention cleanup service and job entry point
- rider mobile proof/document upload controls wired to real API endpoints
- customer mobile signed proof read control wired to real API endpoints
- admin web rider document/proof signed read controls wired to real API endpoints
- provider-backed S3-compatible pre-signed upload/read URLs

Current observability foundation includes:

- structured API request logs with request IDs, path, status code, and latency
- structured worker logs for dispatch job start/completion/failure/error
- `GET /api/v1/health`
- `GET /api/v1/health/ready`
- `GET /api/v1/health/metrics`
- dependency health for PostgreSQL, Redis/cache, object storage, and dispatch queues
- queue counts for waiting, active, delayed, failed, and completed jobs
- runbook trigger keys for degraded dependencies, queue failures, and queue backlog

Current pricing and service-zone foundation includes:

- `pricing_rules` table seeded with default `SEND`, `LIMITED_FETCH`, and `BUSINESS_DELIVERY` rules
- `service_zones` table seeded with `BLR-CENTRAL`
- admin pricing rule list/upsert endpoints
- admin service-zone list/upsert endpoints
- public active service-zone listing
- configured pricing used for new quote snapshots
- historical quote immutability tests after pricing edits
- out-of-zone quote rejection tests
- minimal admin dashboard controls for pricing and zone JSON updates

Current payment provider foundation includes:

- mock provider remains the local default
- Razorpay-compatible order creation adapter using provider credentials
- Razorpay webhook signature verification against raw body
- idempotent handling for `payment.captured`, `payment.failed`, `refund.processed`, and `refund.failed`
- provider refund adapter for mock and Razorpay
- admin payment list endpoint with delivery/refund/transaction detail
- admin payment reconciliation endpoint
- minimal admin dashboard payment monitor and reconcile action

Next spec gap:

- customer checkout UI handoff to Razorpay/client SDK
- scheduled payment reconciliation worker
- richer finance reporting for provider fees, settlements, refunds, and contribution margin
- advanced pricing policy support such as peak surcharges, package limits, and business-specific rate cards
- final storage bucket policy and CORS configuration
- external alert delivery integration such as Sentry/Datadog/PagerDuty
