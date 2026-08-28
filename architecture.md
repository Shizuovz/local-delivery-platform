# Local Delivery Platform Architecture

## 1. Product Decision

Build a controlled local logistics platform, not a full Dunzo clone.

The v1 product must optimize for dispatch reliability, rider operations, transparent pricing, proof of delivery, payment reconciliation, and admin control. Marketplace discovery, food ordering, inventory, wallet, loyalty, dark stores, and complex route optimization are excluded from v1.

The successful operating loop is:

```text
customer/business creates delivery
-> price is locked
-> payment or approved business billing is confirmed
-> rider is assigned
-> pickup is verified
-> delivery is verified
-> payment, refund, rider earning, and platform fee are reconciled
-> every important event is auditable
```

## 2. V1 Scope

### Included

- `SEND`: a customer sends an item from pickup location to drop location.
- `BUSINESS_DELIVERY`: an approved business creates deliveries for its customers.
- `LIMITED_FETCH`: a customer requests pickup from a known source where the item and payment are already arranged.

### Excluded

- Rider-funded shopping or purchasing.
- Food marketplace.
- Open shop discovery.
- Wallet or stored-value system.
- Multi-stop route optimization.
- Subscriptions and loyalty points.
- Dark stores or inventory management.
- Advanced AI dispatch.
- Complex rider batching.
- Marketplace inventory, menus, catalogs, or product substitution.

## 3. Operating Model

Launch in one controlled city or service area with fixed zones, explicit package rules, a small approved rider pool, simple pricing, and mandatory admin fallback.

Core operating rules:

- Only deliver allowed item categories.
- Define max weight, package size, and declared value before launch.
- Require proof at pickup and delivery where operationally appropriate.
- Use admin override for assignment, cancellation, disputes, payment exceptions, and failed deliveries.
- Track contribution margin per delivery from day one.
- Start with one active job per rider unless operations proves batching is safe.
- Treat dispatch and support tooling as core product infrastructure, not back-office extras.

## 4. Recommended Stack

| Layer | Recommendation | Reason |
| --- | --- | --- |
| Customer app | React Native + Expo | Android-first mobile app with iOS-ready path. |
| Rider app | React Native + Expo | Shared mobile stack with rider-specific workflows. |
| Business web | Next.js + TypeScript | Fast dashboard development and shared frontend types. |
| Admin web | Next.js + TypeScript | Operational control center with strong ecosystem support. |
| Backend | NestJS + TypeScript | Modular monolith, validation, guards, dependency injection, maintainability. |
| Database | PostgreSQL + Prisma | Transactional relational data, strong consistency, migrations. |
| Queue/cache | Redis + BullMQ | Dispatch queues, background jobs, OTP/rate limits, retries. |
| Storage | S3-compatible object storage | Delivery photos, rider documents, proof files. |
| Maps | Google Maps Platform or Mapbox | Geocoding, distance, maps, navigation handoff. |
| Payments | Razorpay or equivalent | India-friendly payment processing and webhooks. |
| Notifications | FCM, SMS, WhatsApp/email as needed | Push and critical transactional messaging. |
| Monitoring | Sentry + structured logs + uptime checks | Exception tracking and operational debugging. |

## 5. Repository Architecture

Use a TypeScript monorepo. Turborepo is useful but not mandatory; npm workspaces are enough for a small team.

```text
delivery-platform/
  apps/
    customer-mobile/
    rider-mobile/
    business-web/
    admin-web/
    api/
  packages/
    database/
    types/
    validation/
    config/
    ui/
    utils/
  infra/
    docker/
    migrations/
    deployment/
  docs/
    api/
    architecture/
    runbooks/
  package.json
  README.md
```

Shared packages should contain only stable cross-app contracts. Do not turn the monorepo into a dumping ground for unrelated helpers.

## 6. Backend Module Architecture

The backend should be a modular monolith with clean internal boundaries.

Recommended modules:

- Auth & Sessions
- Users & Roles
- Customers
- Riders
- Businesses
- Addresses & Service Zones
- Deliveries
- Dispatch & Assignment
- Pricing & Quotes
- Payments & Refunds
- Rider Earnings & Settlements
- Tracking
- Proof of Pickup/Delivery
- Notifications
- Support & Disputes
- Admin Operations
- Audit Logs
- Reports & Metrics

Rules:

- Backend is the source of truth for delivery status, price, payment, proof, and permissions.
- Clients may request transitions, but the backend validates and performs them.
- All sensitive actions must pass authorization and object-level ownership checks.
- All financial and state-changing operations must be idempotent where retries are possible.

## 7. Core Data Model

Use UUIDs for public identifiers. Store money in integer minor units such as paise. Never store financial values as floating point numbers.

Core tables:

| Table | Purpose |
| --- | --- |
| `users` | Common identity record. |
| `roles` | Role definitions. |
| `user_roles` | User-to-role mapping. |
| `rider_profiles` | Rider-specific approval, vehicle, and operating status. |
| `rider_documents` | KYC, license, vehicle, and other required documents. |
| `businesses` | Business accounts and approval state. |
| `business_addresses` | Approved pickup or operating addresses for businesses. |
| `addresses` | Reusable normalized customer/business locations. |
| `service_zones` | City zones, polygons, serviceability, pricing linkage. |
| `deliveries` | Main delivery job. |
| `delivery_items` | Package metadata, size, weight, declared value, notes. |
| `delivery_quotes` | Immutable price snapshot. |
| `delivery_status_history` | Immutable lifecycle events. |
| `assignments` | Rider offer, accept, reject, expiry, reassignment records. |
| `rider_locations` | Current/fresh rider location and optional short-retention history. |
| `proofs` | Proof of pickup, delivery, OTP, photo, signature, admin notes. |
| `payments` | Payment order and aggregate payment state. |
| `payment_transactions` | Provider events, captures, failures, webhook IDs. |
| `refunds` | Refund requests, statuses, provider references, reasons. |
| `rider_earnings` | Rider payout components per delivery. |
| `business_settlements` | Business invoicing, postpaid settlement, credits, adjustments. |
| `notifications` | Notification attempts and outcomes. |
| `support_tickets` | Delivery-linked issues, disputes, and support workflow. |
| `audit_logs` | Security, admin, financial, and operational audit trail. |

Critical constraints:

- One active accepted assignment per delivery.
- A historical quote must never change after confirmation.
- Every delivery status change must be recorded.
- Every payment/refund operation must be idempotent.
- Admin edits must be audited with actor, timestamp, reason, and affected entity.
- Proof files must be private and served through signed URLs.
- Rider/customer PII exposure must be minimized by state and role.

## 8. Canonical State Machines

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

Only the backend may transition delivery state. Clients submit actions such as `accept job`, `mark arrived`, or `submit proof`; they do not directly set arbitrary states.

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

A rider can accept only if the offer is active, unexpired, and no other assignment has already been accepted for the delivery.

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

Never trust client-reported payment success. Payment success must come from verified provider response or webhook.

### Refund States

```text
REQUESTED
APPROVED
PROCESSING
SUCCEEDED
FAILED
CANCELLED
```

Refund decisions must be linked to cancellation policy, delivery state, payment state, and admin/support reason.

### Rider Availability States

```text
OFFLINE
ONLINE_IDLE
OFFERED_JOB
ON_ACTIVE_DELIVERY
SUSPENDED
```

Rider availability is operational state, not just a toggle. The system must prevent suspended riders and stale-location riders from receiving offers.

## 9. API Architecture

Use REST for v1. Version endpoints from day one with `/api/v1`.

Auth:

- `POST /api/v1/auth/request-otp`
- `POST /api/v1/auth/verify-otp`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/me`

Customer:

- `POST /api/v1/deliveries/quote`
- `POST /api/v1/deliveries`
- `GET /api/v1/deliveries`
- `GET /api/v1/deliveries/:id`
- `POST /api/v1/deliveries/:id/cancel`
- `GET /api/v1/deliveries/:id/tracking`
- `GET /api/v1/deliveries/:id/proof`

Rider:

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

Business:

- `POST /api/v1/business/deliveries`
- `GET /api/v1/business/deliveries`
- `GET /api/v1/business/deliveries/:id`
- `GET /api/v1/business/reports/deliveries`
- `GET /api/v1/business/profile`

Admin:

- `GET /api/v1/admin/deliveries`
- `POST /api/v1/admin/deliveries/:id/assign`
- `POST /api/v1/admin/deliveries/:id/reassign`
- `POST /api/v1/admin/deliveries/:id/cancel`
- `PATCH /api/v1/admin/users/:id/status`
- `POST /api/v1/admin/riders/:id/approve`
- `PATCH /api/v1/admin/riders/:id/status`
- `PATCH /api/v1/admin/businesses/:id/status`
- `GET /api/v1/admin/support/tickets`
- `PATCH /api/v1/admin/support/tickets/:id`
- `GET /api/v1/admin/reports/operations`
- `GET /api/v1/admin/audit-logs`

## 10. Dispatch And Assignment

V1 dispatch uses deterministic nearest eligible rider assignment with admin fallback.

Eligibility filters:

- Rider is approved.
- Rider is online.
- Rider is not suspended.
- Rider location is fresh.
- Rider supports the package size and vehicle requirements.
- Rider is inside service radius or zone.
- Rider has not exceeded active-job limit.
- Rider has not recently rejected the same job beyond retry rules.

Dispatch flow:

1. Delivery enters `SEARCHING_RIDER`.
2. Dispatch job finds eligible riders.
3. Offer is sent to nearest rider.
4. Rider has 15-30 seconds to accept.
5. Expired or rejected offer moves to the next rider.
6. After configured attempts, expand radius.
7. If no rider accepts, move delivery to admin attention.
8. Admin may manually assign, cancel, or contact customer/business.

Concurrency rules:

- Accepting an assignment must run in a database transaction.
- The system must enforce one accepted assignment per delivery.
- The accept endpoint must be idempotent for retries by the same rider.
- Expired offers cannot be accepted.
- Reassignment must cancel or close the prior active offer/assignment path.

## 11. Pricing And Unit Economics

Pricing must be configuration-driven and server-side.

Example formula:

```text
fare = base_fee
     + distance_fee
     + package_fee
     + zone_surcharge
     + peak_surcharge
     + platform_fee
     + taxes
     - discount
```

Store separately:

- customer delivery revenue
- business delivery revenue
- platform fee
- rider payout
- payment processing fee
- refund/credit
- support adjustment
- maps/SMS/notification cost estimate
- tax components where applicable

Required metric:

```text
contribution_margin =
  revenue
  - rider_payout
  - payment_fee
  - refunds
  - variable_support_cost
  - maps_and_notification_cost
```

Do not launch broad consumer demand until contribution margin is understood.

## 12. Payments And Refunds

Recommended v1 model:

- Customer `SEND` and `LIMITED_FETCH`: prepaid.
- Approved businesses: prepaid or invoiced/postpaid.
- No wallet.
- No rider-funded purchase flow.
- No stored card data.

Rules:

- Create quote snapshot before payment.
- Create provider payment order from backend.
- Verify payment signature/webhook.
- Use idempotency keys for payment order creation, delivery confirmation, refunds, and webhook handling.
- Store provider references and webhook event IDs.
- Refunds are initiated by backend/admin only.
- Cancellation policy determines refund amount.
- Payment success cannot be accepted from client state alone.

Payment failure behavior:

- If payment fails before confirmation, keep delivery unconfirmed or return it to quote flow.
- If payment succeeds but delivery creation fails, reconcile by idempotency key and create/recover the delivery or refund.
- Duplicate webhooks must not duplicate transactions or change state incorrectly.

## 13. LIMITED_FETCH Policy

V1 `LIMITED_FETCH` must be narrow.

Allowed:

- Pickup from known source.
- Item already paid for or no payment required.
- Customer provides pickup reference or instructions.
- Rider only collects and delivers.

Not allowed in v1:

- Rider pays shop.
- Rider chooses substitute item.
- Rider handles prescription validation.
- Rider negotiates price.
- Rider buys restricted or regulated goods.

This restriction avoids early legal, refund, inventory, substitution, and cash-handling complexity.

## 14. Delivery Rules

Freeze these rules before coding production flows:

- Exact service zones.
- Delivery hours.
- Allowed item categories.
- Prohibited items.
- Max package size.
- Max package weight.
- Max declared value.
- Cancellation fees by delivery state.
- Failed delivery handling.
- Return handling.
- Proof requirements by delivery type.
- Rider active-job limit.
- Assignment timeout.
- Support escalation process.

Recommended v1 defaults:

- One city or controlled area.
- Small/medium/large package classes with explicit weight limits.
- One active job per rider.
- Three to five assignment attempts before admin attention.
- Customer cancellation allowed before pickup, with configurable fee after rider assignment or pickup.
- Recipient OTP as default delivery proof.
- Optional photo proof for disputes and business deliveries.

## 15. Location And Tracking

Do not stream GPS every second.

Suggested intervals:

| Context | Suggested interval | Purpose |
| --- | --- | --- |
| Online idle | 60-120 seconds or event-based | Availability and dispatch freshness. |
| Heading to pickup | 10-20 seconds | Customer/business tracking. |
| Active delivery | 5-15 seconds | Operational tracking. |
| Background/no active job | Minimal | Battery and privacy protection. |

Privacy rules:

- Track only for operational need.
- Hide exact rider movement when not assigned.
- Retain raw location data only as long as needed.
- Aggregate or delete old location points.
- Clearly disclose location use and retention.

## 16. Proof Of Pickup And Delivery

Supported proof types:

- OTP
- photo
- signature
- admin note
- pickup reference

Recommended v1:

- Pickup proof for business and `LIMITED_FETCH` jobs.
- Recipient OTP for delivery.
- Optional delivery photo for disputes.
- Signed URLs for proof files.
- Proof uploads linked to actor, timestamp, delivery state, and location if available.

Proof rules:

- A rider cannot mark delivered if required proof is missing.
- Admin proof replacement requires audit trail and reason.
- Proof files are private by default.
- Proof visibility depends on role and delivery ownership.

## 17. Admin Operations Console

Admin is not optional. It is core infrastructure.

Required screens:

- Live delivery board.
- Unassigned/admin attention queue.
- Delivery detail timeline.
- Manual assign/reassign rider.
- Rider approval/suspension.
- Business approval.
- Pricing/service-zone config.
- Payment/refund monitoring.
- Support/dispute queue.
- Audit log viewer.
- Operational reports.

Admin roles:

- Super Admin
- Ops Admin
- Finance Admin
- Support Admin

Sensitive admin actions must require reason capture and audit logging.

## 18. Security And Privacy

Required controls:

- HTTPS everywhere.
- OTP rate limits.
- Refresh-token rotation or secure server sessions.
- Role-based authorization.
- Object-level authorization.
- DTO/schema validation.
- Webhook signature verification.
- Signed URLs for private files.
- Immutable audit logs.
- PII minimization.
- Mask customer/rider phone numbers where possible.
- Do not expose full address/contact data before operationally needed.
- Define retention policy for rider documents, proof images, and location data.
- Never store card data.
- Encrypt sensitive data where required.
- Rate-limit quote, login, order creation, and location endpoints.

India-oriented compliance assumptions:

- Prepare privacy policy and consent flows for personal data use.
- Retain personal data only for defined operational/legal purposes.
- Support deletion/retention workflows where legally applicable.
- Treat rider documents, precise location, customer addresses, and proof photos as sensitive data.
- Follow payment provider and RBI-aligned requirements for card/payment handling.
- Track gig/platform worker obligations as operating scale increases.

## 19. Notifications

Channels:

- Push for app users.
- SMS/WhatsApp for critical events.
- Email optional for business/admin reports.

Events:

- Delivery confirmed.
- Rider assigned.
- Rider arrived pickup.
- Picked up.
- Near destination.
- Delivered.
- Failed/cancelled.
- Refund processed.
- Support ticket update.

Notifications must be template-based and logged. Failed notifications should retry where appropriate without duplicating critical messages.

## 20. Observability And Reliability

Required:

- Structured JSON logs.
- Request ID and delivery ID in logs.
- API latency metrics.
- Queue depth metrics.
- Dispatch assignment time metrics.
- Payment webhook failure alerts.
- Database backup and restore tests.
- Health checks for API and workers.
- Sentry for application exceptions.

Critical metrics:

- quote-to-confirmed rate
- time to rider assignment
- pickup SLA
- delivery SLA
- cancellation rate
- failed delivery rate
- rider acceptance rate
- rider earnings per active hour
- contribution margin per delivery
- support cost per delivery
- payment webhook failure rate
- admin intervention rate

## 21. Background Jobs

| Job | Trigger | Action |
| --- | --- | --- |
| `dispatch.delivery` | Delivery enters `SEARCHING_RIDER` | Find and offer eligible riders. |
| `dispatch.offer-timeout` | Offer expiry | Expire offer and move to next rider. |
| `notifications.send` | Domain event | Send push/SMS/email/WhatsApp. |
| `payment.reconcile` | Scheduled/webhook event | Reconcile provider payment state. |
| `delivery.timeout` | Scheduled/event | Detect stale or stuck deliveries. |
| `rider.location.cleanup` | Scheduled | Remove or aggregate old location points. |
| `reports.daily` | Scheduled | Generate operational summaries. |

All jobs must be idempotent and safe to retry.

## 22. Testing Strategy

Mandatory tests:

- Customer cannot view another customer's delivery.
- Rider cannot update unassigned delivery.
- Delivered delivery cannot move backward.
- Client cannot fake payment success.
- Two riders cannot accept the same delivery.
- Duplicate payment webhooks are idempotent.
- Duplicate order creation is prevented.
- Cancelled delivery cannot be charged again.
- Expired OTP cannot authenticate.
- Admin pricing change does not alter historical quotes.
- Rider with stale location is not eligible.
- Failed delivery enters support/admin workflow.
- Required proof is enforced before delivery completion.
- Business cannot view another business's delivery.
- Suspended rider cannot receive or accept offers.

Test types:

- Unit tests for pricing, state transitions, permissions, and dispatch.
- Integration tests for database/payment/webhook flows.
- API authorization tests.
- End-to-end tests for `SEND`, `BUSINESS_DELIVERY`, and `LIMITED_FETCH`.
- Load tests for quote, tracking, and dispatch endpoints.
- Security tests for IDOR, rate limits, and webhook verification.

## 23. Deployment

Initial deployment may use:

- Vercel for web apps.
- Managed container platform for API and workers.
- Managed PostgreSQL.
- Managed Redis.
- S3-compatible storage.
- CDN/WAF in front of public web/API traffic.

The API must be stateless so horizontal scaling is possible later.

Environments:

- `local`
- `staging`
- `production`

Rules:

- Secrets must never be committed to Git.
- Staging must use separate provider credentials and databases.
- Production database backups must be automated and restore-tested.
- Workers and API instances must have separate health checks.

## 24. Build Roadmap

### Phase 0: Foundation

- Monorepo.
- CI.
- Environments.
- Database schema.
- Auth/session handling.
- Logging.
- Base admin shell.

Exit criteria: all apps build, API deploys, database migrations run, auth works in staging.

### Phase 1: Core Delivery

- Addresses.
- Service zones.
- Quotes.
- `SEND`.
- `BUSINESS_DELIVERY`.
- Delivery lifecycle.

Exit criteria: customer/business can create a priced delivery and see status.

### Phase 2: Rider App

- Onboarding.
- Approval.
- Availability.
- Job offers.
- Job lifecycle.
- Proof upload.

Exit criteria: rider can accept and complete a delivery in staging.

### Phase 3: Dispatch

- Eligibility.
- Offer queue.
- Expiry/retry.
- Transactional locking.
- Admin fallback.

Exit criteria: delivery can be assigned reliably and cannot be double-accepted.

### Phase 4: Payments

- Provider integration.
- Webhooks.
- Refunds.
- Reconciliation.
- Receipts.

Exit criteria: paid delivery reconciles correctly and duplicate webhooks are safe.

### Phase 5: Admin Operations

- Live board.
- Manual assignment.
- Support/disputes.
- Pricing.
- Reporting.
- Audit logs.

Exit criteria: ops team can run the service from admin without developer intervention.

### Phase 6: Hardening

- Security tests.
- Load tests.
- Monitoring.
- Backup restore.
- Operational runbooks.

Exit criteria: production readiness checklist is complete.

## 25. Production Readiness Checklist

- Customer can complete `SEND`.
- Business can create and track delivery.
- `LIMITED_FETCH` works without rider purchase handling.
- Rider can onboard, be approved, go online, accept, and complete job.
- Admin can manually assign and reassign rider.
- Automatic dispatch handles timeout/retry.
- Payment webhooks are verified and idempotent.
- Proof files are private and signed.
- Cancellation/refund rules work.
- All role boundaries are tested.
- Metrics and alerts are active.
- Backup and restore are tested.
- Terms, privacy policy, delivery restrictions, and cancellation policy are prepared.
- Operations team has runbooks for failed deliveries, disputes, and payment issues.
- Contribution margin reporting exists before scaling demand.

## 26. Open Decisions To Freeze Before Coding

These must be decided before implementation starts:

- Exact service zones.
- Allowed/prohibited item list.
- Max package size, weight, and declared value.
- Delivery hours.
- Customer cancellation fees.
- Failed delivery and return policy.
- Rider payout model.
- Business pricing model.
- Whether business accounts are prepaid or invoiced.
- Proof requirements by delivery type.
- Raw location retention period.
- Support escalation process.
- Initial rider active-job limit.
- Payment provider.
- Maps/geocoding provider.
- SMS/WhatsApp provider.
