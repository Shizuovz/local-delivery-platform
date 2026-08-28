# Local Delivery Platform Architecture Essentials

This file is the short, decision-focused architecture guide. If there is a conflict between speed and these essentials, these essentials win.

## 1. Product Shape

Build a controlled logistics platform, not a Dunzo clone.

V1 includes:

- `SEND`: customer sends an item from pickup to drop.
- `BUSINESS_DELIVERY`: approved businesses create deliveries for their customers.
- `LIMITED_FETCH`: pickup from a known source where the item and payment are already arranged.

V1 excludes:

- rider-funded purchases
- food marketplace
- open shop discovery
- wallet
- subscriptions or loyalty
- dark stores
- route optimization
- product substitution
- inventory or catalog management

The goal is reliable delivery completion, not marketplace breadth.

## 2. Operating Rules

Launch with:

- one city or controlled service area
- fixed service zones
- explicit allowed/prohibited item rules
- package size, weight, and declared-value limits
- small approved rider pool
- simple server-side pricing
- admin dispatch fallback
- one active job per rider initially

Do not scale demand until assignment reliability and contribution margin are proven.

## 3. Recommended Stack

- Mobile apps: React Native + Expo
- Business/Admin web: Next.js + TypeScript
- Backend: NestJS modular monolith
- Database: PostgreSQL + Prisma
- Queue/cache: Redis + BullMQ
- Storage: S3-compatible object storage
- Maps: Google Maps Platform or Mapbox
- Payments: Razorpay or equivalent
- Notifications: FCM plus SMS/WhatsApp for critical events
- Monitoring: Sentry, structured logs, health checks, alerts

Use a modular monolith for v1. Do not start with microservices.

## 4. Backend Source Of Truth

The backend owns:

- delivery state
- assignment state
- payment state
- refund state
- quote and price snapshots
- permissions
- proof requirements
- financial records

Clients submit actions. Clients never set arbitrary states, prices, payment success, or proof validity.

## 5. Core Modules

- Auth & Sessions
- Users & Roles
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

## 6. Essential Data Tables

Use UUIDs for public IDs. Store money in integer minor units such as paise.

Required tables:

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

Critical constraints:

- one accepted assignment per delivery
- immutable quote after confirmation
- immutable status history
- idempotent financial operations
- audited admin actions
- signed private proof-file access

## 7. Canonical States

### Delivery

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

### Assignment

```text
PENDING_OFFER
OFFERED
ACCEPTED
REJECTED
EXPIRED
CANCELLED
REASSIGNED
```

### Payment

```text
CREATED
PENDING
PAID
FAILED
REFUND_PENDING
PARTIALLY_REFUNDED
REFUNDED
```

### Refund

```text
REQUESTED
APPROVED
PROCESSING
SUCCEEDED
FAILED
CANCELLED
```

## 8. Dispatch Rules

V1 dispatch is nearest eligible rider with timeout, retry, and admin fallback.

Rider eligibility requires:

- approved profile
- online status
- not suspended
- fresh location
- suitable vehicle/package capability
- inside service zone/radius
- active-job limit not exceeded

Dispatch flow:

1. Delivery enters `SEARCHING_RIDER`.
2. System offers job to nearest eligible rider.
3. Rider has 15-30 seconds to accept.
4. Rejection/expiry moves offer to next rider.
5. Search radius may expand after configured attempts.
6. Delivery enters admin attention if no rider accepts.
7. Admin can assign, reassign, cancel, or contact customer/business.

Concurrency rule:

- Accepting an assignment must run in a database transaction.
- The database must enforce only one accepted assignment per delivery.

## 9. Pricing And Money

Pricing is server-side and configuration-driven.

Formula shape:

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

- revenue
- platform fee
- rider payout
- payment fee
- refund/credit
- support adjustment
- maps/SMS/notification cost estimate
- tax components

Contribution margin must be calculable per delivery:

```text
margin = revenue
       - rider_payout
       - payment_fee
       - refunds
       - variable_support_cost
       - maps_and_notification_cost
```

## 10. Payment Defaults

V1 payment model:

- Customer deliveries are prepaid.
- Approved businesses may be prepaid or invoiced/postpaid.
- No wallet.
- No rider-funded purchase flow.
- No stored card data.

Payment rules:

- create quote snapshot before payment
- create payment order from backend
- verify provider signature/webhook
- use idempotency keys
- store provider references and webhook event IDs
- initiate refunds only from backend/admin
- never trust client payment success

## 11. LIMITED_FETCH Rules

Allowed:

- known pickup source
- already-paid item or no payment needed
- pickup reference/instructions supplied by customer
- rider only collects and delivers

Not allowed:

- rider pays merchant
- rider chooses substitute
- rider validates prescriptions
- rider negotiates price
- rider buys restricted goods

## 12. Proof Rules

Supported proof:

- OTP
- photo
- signature
- pickup reference
- admin note

Recommended v1:

- pickup proof for business and `LIMITED_FETCH`
- recipient OTP for delivery
- optional photo for disputes
- signed URLs for proof files

A rider cannot complete delivery if required proof is missing.

## 13. Admin Is Core Product

Required admin capabilities:

- live delivery board
- unassigned/admin attention queue
- full delivery timeline
- manual assign/reassign
- cancellation with reason
- rider approval/suspension
- business approval
- pricing and zone config
- payment/refund monitoring
- support/dispute handling
- audit log viewer
- operational reports

Sensitive admin actions require reason capture and audit logs.

## 14. Security Essentials

Required:

- HTTPS everywhere
- OTP rate limits
- secure refresh tokens or server sessions
- role-based authorization
- object-level authorization
- DTO/schema validation
- webhook signature verification
- signed URLs for private files
- immutable audit logs
- PII minimization
- masked phone/contact details where possible
- retention rules for documents, proof photos, and location data
- no stored card data

Treat precise location, identity documents, addresses, and proof files as sensitive data.

## 15. Tracking Essentials

Do not stream GPS every second.

Suggested intervals:

- online idle: 60-120 seconds or event-based
- heading to pickup: 10-20 seconds
- active delivery: 5-15 seconds
- no active job/background: minimal

Retain raw location only as long as operationally needed.

## 16. Observability Essentials

Track:

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

Alert on:

- payment webhook failures
- dispatch queue backlog
- API error spikes
- database connectivity issues
- worker failures
- unusually high cancellation/failed delivery rate

## 17. Mandatory Tests

- Customer cannot view another customer's delivery.
- Business cannot view another business's delivery.
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
- Suspended rider cannot receive or accept offers.
- Required proof is enforced before completion.
- Failed delivery enters support/admin workflow.

## 18. Freeze Before Coding

Decide these before implementation starts:

- exact service zones
- allowed/prohibited item list
- max package size, weight, and declared value
- delivery hours
- cancellation fees
- failed delivery and return policy
- rider payout model
- business pricing model
- business prepaid vs invoiced/postpaid policy
- proof requirements by delivery type
- raw location retention period
- support escalation process
- initial rider active-job limit
- payment provider
- maps/geocoding provider
- SMS/WhatsApp provider

## 19. Production Readiness Minimum

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

