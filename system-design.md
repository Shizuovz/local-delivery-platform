# Local Delivery Platform System Design

## 1. Purpose

This document explains how the local delivery platform works internally under real operating conditions. It complements `architecture.md` and `PRD.md` by focusing on request flows, database behavior, queues, locking, APIs, failure handling, scaling, observability, and security enforcement.

The v1 system is deliberately scoped to:

- `SEND`: customer sends an item from pickup to drop.
- `BUSINESS_DELIVERY`: approved businesses create deliveries for their customers.
- `LIMITED_FETCH`: pickup from a known source where the item and payment are already arranged.

The system must not implement rider-funded purchases, food marketplace behavior, wallet, product substitution, dark stores, open shop discovery, or complex route optimization in v1.

## 2. System Context

### External Actors

- Customer mobile/web client
- Rider mobile client
- Business web client
- Admin web console
- Payment provider
- Maps/geocoding provider
- Push/SMS/WhatsApp/email providers
- Object storage provider

### Internal Runtime Components

- API server: NestJS modular monolith exposing REST APIs under `/api/v1`.
- Worker process: BullMQ consumers for dispatch, notifications, reconciliation, cleanup, and reports.
- PostgreSQL: transactional source of truth.
- Redis: queues, dispatch offer timing, rate limits, short-lived OTP state, and cache where appropriate.
- Object storage: rider documents, proof photos, signatures, and other private files.
- Observability stack: structured logs, Sentry, health checks, metrics, alerts.

### High-Level Topology

```text
Mobile/Web Clients
  -> API Gateway / Load Balancer
    -> NestJS API instances
      -> PostgreSQL
      -> Redis / BullMQ
      -> Object Storage
      -> Maps Provider
      -> Payment Provider
      -> Notification Providers

BullMQ Workers
  -> PostgreSQL
  -> Redis
  -> Payment Provider
  -> Notification Providers
  -> Object Storage

Admin Console
  -> API
  -> Live operations data
  -> Audit logs
```

## 3. Design Principles

- Backend is the source of truth for delivery state, assignment state, payment state, refund state, quotes, proof, permissions, and financial records.
- Clients submit actions. Clients never set arbitrary states, prices, payment success, or proof validity.
- PostgreSQL owns transactional correctness. Redis improves timing and throughput but must not be the only source of truth for critical state.
- Every important state change must be persisted in history/audit tables.
- Every retryable financial or delivery-creation operation must be idempotent.
- Admin override is a required recovery path.
- Operational reliability matters more than broad feature coverage in v1.

## 4. Core Domain State

### Delivery States

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

Terminal states:

- `DELIVERED`
- `CANCELLED`
- `FAILED`
- `RETURNED`

Exception states:

- `RETURN_REQUIRED`
- `DISPUTED`

### Assignment States

```text
PENDING_OFFER
OFFERED
ACCEPTED
REJECTED
EXPIRED
CANCELLED
REASSIGNED
```

### Payment States

```text
CREATED
PENDING
PAID
FAILED
REFUND_PENDING
PARTIALLY_REFUNDED
REFUNDED
```

### Refund States

```text
REQUESTED
APPROVED
PROCESSING
SUCCEEDED
FAILED
CANCELLED
```

## 5. API Design

All public APIs use REST under `/api/v1`.

APIs are action-oriented where state transitions are involved. For example, riders call `POST /rider/jobs/:id/picked-up`; they do not call a generic endpoint that sets delivery status to `PICKED_UP`.

### Auth And Session APIs

- `POST /api/v1/auth/request-otp`
- `POST /api/v1/auth/verify-otp`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/me`

### Customer Delivery APIs

- `POST /api/v1/deliveries/quote`
- `POST /api/v1/deliveries`
- `GET /api/v1/deliveries`
- `GET /api/v1/deliveries/:id`
- `POST /api/v1/deliveries/:id/cancel`
- `GET /api/v1/deliveries/:id/tracking`
- `GET /api/v1/deliveries/:id/proof`

### Rider Job Lifecycle APIs

- `PATCH /api/v1/rider/availability`
- `GET /api/v1/rider/jobs/offers`
- `POST /api/v1/rider/jobs/:id/accept`
- `POST /api/v1/rider/jobs/:id/reject`
- `POST /api/v1/rider/jobs/:id/arrived-pickup`
- `POST /api/v1/rider/jobs/:id/picked-up`
- `POST /api/v1/rider/jobs/:id/arrived-drop`
- `POST /api/v1/rider/jobs/:id/delivered`
- `POST /api/v1/rider/location`
- `GET /api/v1/rider/earnings`

### Business APIs

- `POST /api/v1/business/deliveries`
- `GET /api/v1/business/deliveries`
- `GET /api/v1/business/deliveries/:id`
- `GET /api/v1/business/reports/deliveries`
- `GET /api/v1/business/profile`

### Admin Operations APIs

- `GET /api/v1/admin/deliveries`
- `POST /api/v1/admin/deliveries/:id/assign`
- `POST /api/v1/admin/deliveries/:id/reassign`
- `POST /api/v1/admin/deliveries/:id/cancel`
- `POST /api/v1/admin/deliveries/:id/mark-exception`
- `PATCH /api/v1/admin/users/:id/status`
- `POST /api/v1/admin/riders/:id/approve`
- `PATCH /api/v1/admin/riders/:id/status`
- `PATCH /api/v1/admin/businesses/:id/status`
- `GET /api/v1/admin/support/tickets`
- `PATCH /api/v1/admin/support/tickets/:id`
- `GET /api/v1/admin/reports/operations`
- `GET /api/v1/admin/payments`
- `POST /api/v1/admin/payments/:id/reconcile`
- `GET /api/v1/admin/audit-logs`

### Payment APIs

- `GET /api/v1/payments/:id/checkout`
- `POST /api/v1/payments/mock/confirm`
- `POST /api/v1/payments/webhooks/mock`
- `POST /api/v1/payments/webhooks/razorpay`

Checkout APIs return only client-safe provider options. Webhook endpoints must verify provider signature, store raw provider event IDs, and process events idempotently.

## 6. Core Request Flows

### 6.1 OTP Login

```text
Client
  -> POST /auth/request-otp
API
  -> rate-limit by phone/IP/device
  -> create short-lived OTP challenge
  -> send OTP through provider
Client
  -> POST /auth/verify-otp
API
  -> verify challenge and expiry
  -> create or load user
  -> issue access token + refresh token/session
  -> audit login event
```

Failure handling:

- Expired OTP returns a generic invalid/expired response.
- Too many attempts locks the challenge temporarily.
- OTP values must not be logged.

### 6.2 Quote Creation

```text
Client
  -> POST /deliveries/quote
API
  -> validate service type
  -> validate pickup/drop address
  -> geocode/normalize if needed
  -> validate service zone
  -> validate package restrictions
  -> calculate distance
  -> calculate fare server-side
  -> persist delivery_quote snapshot with expiry
  -> return quote ID, price components, ETA, expiry
```

Rules:

- Quote calculation is backend-only.
- Quote stores all pricing components separately.
- Quote has an expiry.
- Confirmed quotes are immutable.
- Pricing edits do not affect historical quotes.

### 6.3 Customer Prepaid SEND

```text
Customer
  -> POST /deliveries/quote
API
  -> create quote snapshot
Customer
  -> POST /deliveries with quote_id + idempotency_key
API
  -> validate quote ownership and expiry
  -> create DRAFT/CONFIRMED delivery record
  -> create payment order
  -> return payment order details
Customer
  -> completes provider payment
Payment Provider
  -> webhook to /webhooks/payments/provider
API
  -> verify signature
  -> idempotently mark payment PAID
  -> mark delivery CONFIRMED if needed
  -> enqueue dispatch.delivery
Worker
  -> process dispatch
```

Implementation note:

- The exact point where `deliveries` is created can be either before or after payment, but the flow must be idempotent. A payment success with a valid idempotency key must recover the intended delivery rather than creating duplicates.

### 6.4 Business Postpaid Delivery

```text
Business
  -> POST /business/deliveries
API
  -> verify business approval and billing mode
  -> validate serviceability and package restrictions
  -> calculate business quote
  -> create immutable quote snapshot
  -> create delivery as CONFIRMED
  -> create business_settlement ledger item
  -> enqueue dispatch.delivery
Business
  -> sees active delivery status
```

Rules:

- Only approved businesses may create deliveries.
- Postpaid business deliveries must create ledger/settlement records.
- Business pricing can be negotiated but must still be snapshotted.

### 6.5 Dispatch Offer And Accept

```text
Worker dispatch.delivery
  -> load delivery
  -> ensure delivery is CONFIRMED or SEARCHING_RIDER
  -> transition delivery to SEARCHING_RIDER
  -> find eligible riders
  -> create OFFERED assignment for nearest rider
  -> send rider notification
  -> schedule dispatch.offer-timeout

Rider
  -> POST /rider/jobs/:assignment_id/accept
API transaction
  -> lock assignment row
  -> lock delivery row
  -> verify assignment is OFFERED and unexpired
  -> verify delivery has no accepted assignment
  -> verify rider is still eligible
  -> mark assignment ACCEPTED
  -> mark other open offers CANCELLED/EXPIRED
  -> transition delivery to RIDER_ASSIGNED
  -> write delivery_status_history
  -> write audit/event records
  -> notify customer/business
```

Database rule:

- Enforce one accepted assignment per delivery with a partial unique index or equivalent database constraint.

Timeout behavior:

```text
Worker dispatch.offer-timeout
  -> load assignment
  -> if still OFFERED and expired, mark EXPIRED
  -> offer next eligible rider
  -> after configured attempts/radius expansion, move delivery to admin attention
```

### 6.6 Pickup Proof

```text
Rider
  -> POST /rider/jobs/:id/arrived-pickup
API
  -> verify rider owns accepted assignment
  -> verify transition allowed
  -> transition delivery to ARRIVED_PICKUP

Rider
  -> POST /rider/jobs/:id/picked-up with proof payload if required
API
  -> verify required pickup proof
  -> store proof metadata
  -> upload/store file reference when needed
  -> transition delivery to PICKED_UP
  -> notify customer/business
```

Rules:

- Business and `LIMITED_FETCH` jobs should require pickup proof by default.
- Required proof cannot be bypassed by rider client.
- Proof files are private and served by signed URLs.

### 6.7 Delivery Proof

```text
Rider
  -> POST /rider/jobs/:id/arrived-drop
API
  -> verify transition allowed
  -> transition delivery to ARRIVED_DROP

Rider
  -> POST /rider/jobs/:id/delivered with OTP/photo/signature
API transaction
  -> verify rider owns delivery
  -> verify required proof
  -> store proof record
  -> transition delivery to DELIVERED
  -> calculate rider earning
  -> close assignment lifecycle
  -> notify customer/business
  -> write financial/audit events
```

Rules:

- Recipient OTP is the recommended default proof.
- Optional photo proof can be required for businesses, disputes, or policy-specific cases.
- Delivery cannot move backward from `DELIVERED`.

### 6.8 Cancellation And Refund

```text
Customer/Business/Admin
  -> POST cancel endpoint
API transaction
  -> verify actor permission
  -> load delivery/payment/assignment
  -> determine cancellation eligibility by state
  -> compute fee/refund eligibility
  -> transition delivery to CANCELLED or RETURN_REQUIRED
  -> cancel open assignments where appropriate
  -> create refund record if eligible
  -> enqueue refund processing if payment was captured
  -> write status history and audit log
```

Rules:

- Cancellation after pickup may require return flow instead of immediate cancellation.
- Refund state must remain consistent with payment state.
- Admin cancellation must capture reason.
- A cancelled delivery cannot be charged again.

### 6.9 Duplicate-Safe Payment Webhook

```text
Payment Provider
  -> POST /payments/webhooks/:provider
API
  -> verify signature
  -> extract provider_event_id
  -> check payment_transactions for provider_event_id
  -> if already processed, return success
  -> persist transaction event
  -> load payment by provider reference
  -> apply valid state transition
  -> enqueue dispatch or refund follow-up when needed
  -> return success
```

Rules:

- Always return success for already-processed valid events to prevent provider retry storms.
- Invalid signatures return unauthorized.
- Unknown payment references are recorded for reconciliation and alerting.

### 6.10 Admin Reassignment

```text
Admin
  -> POST /admin/deliveries/:id/reassign with rider_id + reason
API transaction
  -> verify admin permission
  -> lock delivery
  -> verify delivery is reassignable
  -> cancel or mark previous assignment REASSIGNED
  -> create accepted/manual assignment or offered assignment based on policy
  -> update delivery state if needed
  -> write delivery_status_history
  -> write audit log with reason
  -> notify rider/customer/business
```

Rules:

- Reassignment must never create two active accepted assignments.
- Admin actions require reason capture.
- Reassignment is visible in the delivery timeline.

## 7. Data Design

### 7.1 Primary Tables

Core transactional tables:

- `users`
- `roles`
- `user_roles`
- `rider_profiles`
- `rider_documents`
- `businesses`
- `business_addresses`
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

### 7.2 Ownership Rules

- Customer owns deliveries where `deliveries.customer_id = current_user.id`.
- Business user can access deliveries for approved businesses they belong to.
- Rider can access only currently offered, accepted, or historically assigned jobs.
- Ops Admin can access operational delivery records.
- Finance Admin can access financial records but should not automatically receive broad operational mutation rights.
- Super Admin can access all records.

### 7.3 Recommended Constraints

- Unique phone/email where applicable on `users`.
- Unique role codes on `roles`.
- Unique active business membership where applicable.
- Partial unique constraint for one accepted assignment per delivery.
- Unique provider event ID on `payment_transactions`.
- Unique idempotency key per actor/action scope.
- Foreign keys from delivery records to quote, payment, addresses, business, and customer.
- Immutable quote snapshot after delivery confirmation.

### 7.4 Recommended Indexes

- `deliveries(status, created_at)`
- `deliveries(customer_id, created_at)`
- `deliveries(business_id, created_at)`
- `deliveries(type, status, created_at)`
- `assignments(delivery_id, status)`
- `assignments(rider_id, status, created_at)`
- `rider_locations(rider_id, recorded_at)`
- `payments(provider, provider_ref)`
- `payment_transactions(provider, provider_event_id)`
- `delivery_status_history(delivery_id, timestamp)`
- `audit_logs(actor_id, created_at)`
- `audit_logs(entity_type, entity_id, created_at)`
- `support_tickets(status, created_at)`

### 7.5 Financial Storage

Do not store only a final profit number. Store every component separately:

- customer revenue
- business revenue
- platform fee
- rider payout
- payment processing fee
- refund
- support adjustment
- maps/SMS/notification estimated variable cost
- tax components where applicable

All money fields use integer minor units.

### 7.6 Retention-Sensitive Records

Retention policy must cover:

- rider identity documents
- proof photos/signatures
- raw GPS location history
- OTP challenges
- payment webhook payloads
- customer addresses
- support messages and dispute evidence

Prefer short retention for raw GPS and OTP challenges. Preserve audit and financial records according to legal/accounting requirements.

## 8. Queue And Worker Design

### Required Queues

| Queue | Purpose |
| --- | --- |
| `dispatch.delivery` | Find and offer eligible riders. |
| `dispatch.offer-timeout` | Expire rider offers and continue assignment. |
| `notifications.send` | Send push/SMS/WhatsApp/email. |
| `payment.reconcile` | Scheduled worker reconciles stale provider-backed pending payment state. |
| `delivery.timeout` | Detect stale or stuck deliveries. |
| `rider.location.cleanup` | Remove or aggregate old location data. |
| `reports.daily` | Generate operational and financial summaries. |

### Queue Rules

- Jobs must be idempotent.
- Jobs must be safe to retry.
- Job payloads should contain IDs, not full mutable objects.
- Workers must re-load current state from PostgreSQL before acting.
- Failed jobs must move to dead-letter or admin-visible failure reporting after retry exhaustion.

### Dispatch Retry Rules

- Offer timeout default: 15-30 seconds.
- Initial attempts: 3-5 riders.
- After failed attempts, expand service radius if policy allows.
- If still unassigned, put delivery in admin attention.
- Do not offer to riders with stale location or suspended status.

## 9. Concurrency And Idempotency

### Rider Acceptance Transaction

The accept endpoint must:

1. Lock the assignment row.
2. Lock the delivery row.
3. Verify assignment status is `OFFERED`.
4. Verify offer has not expired.
5. Verify delivery has no accepted assignment.
6. Verify rider remains eligible.
7. Mark assignment `ACCEPTED`.
8. Cancel/expire competing open offers.
9. Transition delivery to `RIDER_ASSIGNED`.
10. Write status history and audit/event records.

### Idempotency Key Scopes

Use idempotency keys for:

- delivery creation
- payment order creation
- payment webhook processing
- refund creation
- rider accept action
- admin assignment/reassignment
- proof upload completion

Recommended key structure:

```text
actor_id + action_type + client_generated_key
```

Provider webhook idempotency uses provider event ID.

### Duplicate Handling

- Duplicate delivery creation with the same idempotency key returns the original result.
- Duplicate rider accept by same rider returns current accepted result if still valid.
- Duplicate rider accept by different rider fails if another assignment is already accepted.
- Duplicate webhook returns success after verifying it was already processed.
- Duplicate refund request returns the existing refund record.

## 10. Failure Modes And Recovery

### No Riders Available

- Delivery remains or enters `SEARCHING_RIDER`.
- Dispatch attempts are exhausted.
- Delivery moves to admin attention.
- Admin contacts customer/business or assigns manually.

### Rider Accepts Then Goes Offline

- Delivery remains assigned initially.
- `delivery.timeout` detects stale progress/location.
- Admin attention is raised.
- Admin can reassign, cancel, or contact rider.

### Payment Succeeds But Delivery Creation Fails

- Payment webhook or reconciliation job uses idempotency key/provider reference to recover intended delivery.
- If recovery is impossible, create refund workflow and alert finance/admin.

### Payment Webhook Arrives Twice

- Unique provider event ID prevents duplicate processing.
- API returns success for already-processed valid event.

### Rider App Killed During Delivery

- Last known state and location remain in PostgreSQL.
- Timeout job detects lack of progress.
- Admin attention is raised.
- Rider can resume from backend state after reopening app.

### Required Proof Missing

- Backend rejects completion action.
- Delivery remains in current state.
- Rider receives actionable error.
- Admin can resolve only with audited override where policy allows.

### Address Inaccessible Or Recipient Unavailable

- Rider reports issue.
- Delivery moves to support/admin attention or `RETURN_REQUIRED`.
- Refund/cancellation policy is evaluated by state.

## 11. Security And Privacy Design

### Authentication

- OTP-based login for v1.
- OTP requests are rate-limited by phone, IP, and device where possible.
- OTP challenges are short-lived.
- Refresh tokens rotate or sessions are server-side.

### Authorization

Use both:

- role-based authorization for broad capability
- object-level authorization for record ownership

Examples:

- Customer can view only own deliveries.
- Business can view only deliveries for its business.
- Rider can update only assigned delivery through allowed actions.
- Finance Admin can view payment/refund reports but should not automatically mutate delivery operations.

### PII Minimization

- Mask phone numbers where direct contact is not needed.
- Expose pickup/drop details progressively by delivery state.
- Do not expose full customer information to riders before operational need.
- Use signed URLs for proof files and rider documents.

### Webhook Security

- Verify provider signatures.
- Reject unsigned/invalid webhook payloads.
- Store provider event IDs.
- Record raw payload metadata according to retention policy.

### Audit Logging

Audit logs are required for:

- admin assignment/reassignment
- admin cancellation
- refunds
- pricing changes
- service-zone changes
- proof replacement
- rider/business approval or suspension
- permission/role changes
- sensitive data access where practical

Audit logs must include actor, action, entity type, entity ID, timestamp, reason where required, and metadata.

## 12. Tracking Design

### Location Update Policy

Suggested intervals:

- Online idle: 60-120 seconds or event-based.
- Heading to pickup: 10-20 seconds.
- Active delivery: 5-15 seconds.
- Background/no active job: minimal.

### Stale Location

A rider location is stale when the last accepted location update is older than the configured freshness threshold for dispatch. Stale riders are excluded from automatic offers.

### Storage Policy

- Keep latest rider location for dispatch.
- Keep short-retention location history only while operationally useful.
- Aggregate or delete old raw points according to retention policy.

## 13. Proof And Object Storage Design

### Upload Flow

```text
Client
  -> request upload intent
API
  -> verify actor and delivery state
  -> create signed upload URL or upload session
Client
  -> upload file to object storage
Client
  -> submit proof completion request
API
  -> verify object reference
  -> create proof record
  -> transition state if proof satisfies requirement
```

### Access Flow

```text
Authorized user
  -> GET proof endpoint
API
  -> verify object-level access
  -> return signed read URL or sanitized proof metadata
```

Rules:

- Proof files are private by default.
- Proof records are linked to delivery, actor, proof type, timestamp, and state.
- Proof replacement is admin-only and audited.

## 14. Observability And Operations

### Structured Logs

Include:

- request ID
- actor ID where available
- delivery ID where relevant
- assignment ID where relevant
- payment ID/provider reference where relevant
- job ID for worker logs
- error code and safe error context

Do not log OTPs, tokens, full payment payloads with sensitive data, or private document/proof URLs.

### Metrics

Track:

- quote-to-confirmed rate
- time to rider assignment
- assignment success rate
- pickup SLA
- delivery SLA
- cancellation rate
- failed delivery rate
- rider acceptance rate
- rider earnings per active hour
- contribution margin per delivery
- support cost per delivery
- payment webhook failure rate
- duplicate webhook count
- admin intervention rate
- dispatch queue backlog
- worker failure count

### Alerts

Alert on:

- payment webhook verification failures
- payment reconciliation mismatch
- dispatch queue backlog
- high unassigned delivery count
- API error spikes
- database connectivity issues
- Redis/queue connectivity issues
- worker failures
- unusually high cancellation or failed delivery rate
- object storage upload failures

### Health Checks

API health check:

- process alive
- database reachable
- Redis reachable
- basic configuration present

Worker health check:

- process alive
- Redis reachable
- database reachable
- queue processing not stalled

## 15. Deployment And Scaling

### V1 Deployment

- Web apps can deploy to Vercel or equivalent.
- API and workers deploy as managed containers.
- PostgreSQL, Redis, and object storage should be managed services where possible.
- API must be stateless.
- Workers can scale independently from API.

### Scaling Path

Initial:

- one or more API instances
- one worker process
- managed PostgreSQL
- managed Redis

Scale later by:

- increasing API instances
- separating worker types
- tuning queue concurrency
- adding read replicas for reporting
- extracting modules only after operational evidence proves the need

Do not split into microservices in v1.

## 16. Test Plan

### Concurrency Tests

- Two riders attempt to accept the same assignment at the same time.
- Rider accepts after offer expiry.
- Admin reassigns while rider accepts.
- Duplicate delivery creation request uses same idempotency key.

### Payment Tests

- Client claims success without webhook.
- Provider sends duplicate webhook.
- Provider sends invalid signature.
- Payment succeeds but delivery creation previously failed.
- Refund request is retried.

### Authorization Tests

- Customer cannot view another customer's delivery.
- Business cannot view another business's delivery.
- Rider cannot update unassigned delivery.
- Finance Admin cannot perform unauthorized ops mutation.
- Suspended rider cannot accept offer.

### State Machine Tests

- Delivered delivery cannot move backward.
- Cancelled delivery cannot be charged again.
- Required proof blocks delivery completion.
- Cancellation after pickup triggers return/admin flow where configured.
- Failed dispatch moves delivery to admin attention.

### Dispatch Tests

- Stale-location rider is excluded.
- Offline rider is excluded.
- Rider over active-job limit is excluded.
- Rejected rider is not immediately re-offered beyond retry policy.
- No rider available creates admin attention item.

### Data Integrity Tests

- Pricing change does not mutate historical quote.
- Every delivery transition writes `delivery_status_history`.
- Admin reassignment writes audit log.
- Financial component records can calculate contribution margin.
- Proof file access requires signed URL and object-level authorization.

## 17. Production Readiness Checks

Do not launch until:

- customer can complete `SEND`
- business can create and track delivery
- `LIMITED_FETCH` works without rider purchase handling
- rider can onboard, be approved, go online, accept, and complete job
- admin can manually assign and reassign rider
- automatic dispatch handles timeout/retry
- payment webhooks are verified and idempotent
- proof files are private and signed
- cancellation/refund rules work
- role boundaries are tested
- monitoring and alerts are active
- backup and restore are tested
- terms, privacy policy, delivery restrictions, and cancellation policy are ready
- operations runbooks exist for failed deliveries, disputes, and payment issues
- contribution margin reporting exists

## 18. Open Engineering Decisions

These decisions must be frozen before production implementation:

- exact service-zone geometry model
- address normalization/geocoding provider contract
- payment provider final API contract
- SMS/WhatsApp provider contract
- OTP storage approach and expiry policy
- raw location retention period
- proof file retention period
- rider active-job limit
- assignment timeout and retry count
- cancellation fee matrix
- refund approval workflow
- rider payout formula
- business settlement cadence
- support escalation SLA
