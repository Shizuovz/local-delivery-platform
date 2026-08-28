# Local Delivery Platform PRD

## 1. Overview

### Product Name

Local Delivery Platform

### Product Type

Controlled local logistics platform for customers, riders, businesses, and operations teams.

### Product Decision

Build a logistics operating system, not a broad marketplace clone.

The first version must prove that the platform can reliably price, assign, pick up, deliver, verify, reconcile, and audit local deliveries inside a controlled service area. A beautiful app is not enough; the product succeeds only if delivery completion, dispatch reliability, unit economics, and operational recovery work.

### Core V1 Promise

Customers and approved businesses can create local delivery jobs, the system locks a price, assigns a verified rider, tracks delivery progress, verifies pickup/delivery, reconciles payment or business billing, and gives admins full operational control when something goes wrong.

## 2. Goals And Non-Goals

### Goals

- Enable customers to create and track `SEND` deliveries.
- Enable approved businesses to create and track `BUSINESS_DELIVERY` jobs.
- Enable `LIMITED_FETCH` jobs where pickup is pre-arranged and no rider-funded purchase is required.
- Provide riders with a reliable mobile workflow for availability, offers, pickup, delivery, proof, and earnings.
- Give admins a live operations console for dispatch, exceptions, payments, disputes, pricing, zones, and audits.
- Ensure backend-owned state, pricing, payment, permissions, and proof validation.
- Measure dispatch reliability and contribution margin from day one.

### Non-Goals For V1

- Food ordering marketplace.
- Open shop discovery.
- Rider-funded purchases.
- Wallet or stored-value system.
- Loyalty points or subscriptions.
- Dark stores or owned inventory.
- Product catalog management.
- Product substitution.
- Complex route optimization.
- Multi-stop batching.
- Advanced AI dispatch.
- Multi-city launch.

## 3. Target Users

### Customer

People who need to send an item locally or request pickup from a known source. They need simple pricing, reliable pickup, live status, and proof that the delivery was completed.

### Rider

Approved delivery partners who accept delivery jobs, navigate to pickup/drop locations, verify pickup, complete delivery, upload proof, and view earnings.

### Business

Local stores, service businesses, clinics, offices, repair shops, and other approved businesses that need to create delivery jobs for their customers.

### Admin / Dispatcher

Operations staff responsible for rider approval, live dispatch, manual assignment, cancellations, disputes, refunds, service zones, pricing, and support recovery.

### Finance Admin

Internal user responsible for payment monitoring, refunds, business settlements, rider earnings, and reconciliation.

## 4. V1 Service Types

### SEND

A customer sends an item from a pickup address to a drop address.

Examples:

- Send documents to an office.
- Send keys to a family member.
- Send a small parcel to a nearby customer.

### BUSINESS_DELIVERY

An approved business creates a delivery job for one of its customers.

Examples:

- Local store delivers a prepaid order.
- Clinic sends reports.
- Repair shop sends a repaired item.

### LIMITED_FETCH

A customer requests pickup from a known source where the item is already paid for or no payment is required.

Allowed:

- Customer provides pickup source.
- Customer provides pickup reference or instructions.
- Rider only collects and delivers.

Not allowed:

- Rider pays merchant.
- Rider chooses substitute items.
- Rider validates prescription legality.
- Rider negotiates price.
- Rider buys restricted goods.

## 5. Launch Operating Model

V1 must launch in a controlled operating environment.

Requirements:

- One city or controlled service area.
- Fixed service zones or polygons.
- Defined delivery hours.
- Approved rider pool only.
- Approved businesses only.
- Explicit package classes.
- Explicit allowed/prohibited items.
- One active job per rider initially.
- Admin assignment fallback always available.
- Simple pricing model configured server-side.
- Customer deliveries prepaid by default.
- Business deliveries prepaid or approved postpaid/invoiced.

## 6. Success Metrics

### Marketplace Reliability

- Time to rider assignment.
- Assignment success rate.
- Rider acceptance rate.
- Pickup SLA.
- Delivery SLA.
- Failed delivery rate.
- Cancellation rate.
- Admin intervention rate.

### Customer And Business Experience

- Quote-to-confirmed rate.
- Delivery completion rate.
- Repeat customer rate.
- Repeat business account usage.
- Support ticket rate per delivery.
- Refund/dispute rate.

### Rider Health

- Rider earnings per job.
- Rider earnings per active hour.
- Rider utilization.
- Rider cancellation/no-show rate.
- Rider retention.

### Financial Health

- Revenue per delivery.
- Rider payout per delivery.
- Payment fee per delivery.
- Support cost per delivery.
- Notification/maps cost per delivery.
- Refund/credit cost per delivery.
- Contribution margin per delivery.

### Reliability And Security

- Payment webhook failure rate.
- Duplicate webhook safe-handling rate.
- API error rate.
- Dispatch queue backlog.
- Authorization failure/test coverage.
- Backup restore success.

## 7. User Journeys

### 7.1 Customer SEND Journey

1. Customer opens app or responsive web.
2. Customer authenticates with phone/email OTP.
3. Customer chooses `SEND`.
4. Customer enters pickup address.
5. Customer enters drop address.
6. System validates serviceability.
7. Customer enters package type, size, approximate weight, declared value, and notes.
8. System calculates quote and ETA.
9. Customer reviews price, cancellation rules, and item restrictions.
10. Customer confirms.
11. Customer completes prepaid payment.
12. Backend verifies payment.
13. Delivery enters `SEARCHING_RIDER`.
14. Rider accepts assignment.
15. Customer sees rider and live status.
16. Rider arrives at pickup.
17. Pickup is verified where required.
18. Rider marks picked up.
19. Customer tracks delivery progress.
20. Recipient verifies delivery using OTP or configured proof.
21. Rider submits proof.
22. Delivery becomes `DELIVERED`.
23. Customer receives receipt and proof.

### 7.2 Customer LIMITED_FETCH Journey

1. Customer chooses `LIMITED_FETCH`.
2. Customer enters pickup source.
3. Customer confirms item is already paid for or no payment is required.
4. Customer enters pickup reference/instructions.
5. Customer enters delivery address.
6. System validates serviceability.
7. System calculates delivery-only price.
8. Customer pays.
9. Rider is assigned.
10. Rider picks up item using provided instructions/reference.
11. Rider submits pickup proof if required.
12. Rider delivers to customer.
13. Customer verifies receipt.
14. Delivery is completed with proof.

### 7.3 Business Delivery Journey

1. Business logs in.
2. Business creates delivery with customer name/contact, drop address, package details, and order reference.
3. System validates serviceability and business permissions.
4. System calculates business rate or uses configured negotiated pricing.
5. Business confirms delivery.
6. If prepaid, payment is completed; if postpaid, job is added to settlement ledger.
7. Delivery enters dispatch queue.
8. Rider accepts and completes pickup/delivery.
9. Business sees live delivery status.
10. Proof is stored against business order reference.
11. Business can export delivery history and statements.

### 7.4 Rider Journey

1. Rider signs in.
2. Rider completes onboarding and document submission.
3. Admin approves rider.
4. Rider goes online.
5. Rider receives eligible job offer.
6. Rider accepts or rejects within timeout.
7. Rider navigates to pickup.
8. Rider marks arrived at pickup.
9. Rider verifies pickup and submits proof if required.
10. Rider marks picked up.
11. Rider navigates to drop.
12. Rider marks arrived at drop.
13. Rider collects OTP/signature/photo proof as required.
14. Rider marks delivered.
15. Rider sees completed job and earnings.
16. Rider reports issues when delivery cannot proceed.

### 7.5 Admin Dispatch Journey

1. Admin opens live operations board.
2. Admin filters by zone, status, rider, business, delivery type, or age.
3. Admin sees unassigned and stuck deliveries.
4. Admin opens delivery timeline.
5. Admin manually assigns or reassigns rider.
6. Admin contacts customer/business/rider if required.
7. Admin marks operational exception with reason.
8. Admin cancels, returns, disputes, or resolves delivery according to policy.
9. All actions are audited.

## 8. Functional Requirements

## 8.1 Authentication And Accounts

### Customer Requirements

- Customer can sign in using OTP.
- Customer can view and edit profile details.
- Customer can save addresses.
- Customer can view order history.
- Customer can view receipts and proof.

### Rider Requirements

- Rider can sign in using OTP.
- Rider can submit onboarding information.
- Rider can upload required documents.
- Rider cannot receive jobs until approved.
- Rider can view approval status.
- Rider can update availability.
- Rider can view earnings and completed jobs.

### Business Requirements

- Business can request or receive account access.
- Business must be approved by admin.
- Business can manage profile and pickup addresses.
- Business can create deliveries.
- Business can view active/completed deliveries.
- Business can export delivery reports.

### Admin Requirements

- Admin users require role-based access.
- Admin roles include Super Admin, Ops Admin, Finance Admin, and Support Admin.
- Admin access must be auditable.
- Admins can manage customers, riders, businesses, deliveries, pricing, zones, payments, disputes, and reports according to role.

## 8.2 Delivery Creation

Requirements:

- User selects service type.
- User enters pickup and drop details.
- System validates serviceability.
- User enters package details.
- System validates package restrictions.
- System creates quote.
- User confirms quote.
- Backend creates delivery only after confirmation/payment or approved business billing path.

Package details:

- item description
- package class
- approximate weight
- quantity
- declared value
- notes/instructions
- prohibited item confirmation

## 8.3 Quotes And Pricing

Requirements:

- Quote is calculated only on backend.
- Quote includes serviceability, distance, price, estimated ETA, and expiry.
- Quote must be immutable after confirmation.
- Quote must store pricing components separately.
- Pricing rules must be configurable by admin.
- Pricing changes cannot affect historical deliveries.

Quote components:

- base fee
- distance fee
- package fee
- zone surcharge
- peak surcharge
- platform fee
- taxes
- discounts

## 8.4 Payments

Requirements:

- Customer deliveries are prepaid by default.
- Approved businesses may use prepaid or postpaid/invoiced billing.
- Backend creates payment order.
- Backend verifies provider response/webhook.
- System never trusts client-side payment success.
- Duplicate webhooks must be idempotent.
- Payment failure must not create duplicate deliveries.
- Refunds are backend/admin initiated only.
- Card data must never be stored.

## 8.5 Dispatch And Assignment

Requirements:

- Delivery enters dispatch only after confirmation.
- System filters eligible riders.
- System offers job to nearest eligible rider.
- Offer expires after configured timeout.
- Rejected/expired jobs move to next rider.
- Search radius may expand.
- Delivery enters admin attention after failed attempts.
- Admin can manually assign/reassign.
- Two riders cannot accept the same delivery.

Eligibility:

- rider approved
- online
- not suspended
- fresh location
- vehicle/package capable
- inside service zone
- active-job limit not exceeded

## 8.6 Rider Delivery Workflow

Requirements:

- Rider can go online/offline.
- Rider can receive offer with limited details.
- Rider can accept/reject.
- Rider can navigate to pickup/drop.
- Rider can mark arrived pickup.
- Rider can confirm pickup.
- Rider can mark arrived drop.
- Rider can submit proof.
- Rider can complete delivery.
- Rider can report issue.
- Rider cannot skip required state transitions.
- Rider cannot complete delivery without required proof.

Issue types:

- customer unavailable
- recipient unavailable
- address inaccessible
- package mismatch
- package damaged
- payment issue
- rider vehicle issue
- rider safety issue
- app/network issue

## 8.7 Proof Of Pickup And Delivery

Requirements:

- System supports OTP, photo, signature, pickup reference, and admin note.
- Required proof depends on delivery type and policy.
- Proof files are private.
- Proof files use signed URLs.
- Proof records include actor, timestamp, delivery, proof type, and metadata.
- Admin proof replacement requires reason and audit.

Recommended defaults:

- recipient OTP for customer delivery
- pickup proof for business delivery
- pickup proof for limited fetch
- optional photo for disputes

## 8.8 Tracking

Requirements:

- Rider location updates only while online or on active delivery.
- Tracking frequency depends on job state.
- Customer/business can view live tracking when assigned.
- System must handle stale GPS.
- System must handle rider app killed/backgrounded.
- Raw location retention must be limited by policy.

Suggested intervals:

- online idle: 60-120 seconds or event-based
- heading to pickup: 10-20 seconds
- active delivery: 5-15 seconds
- no active job/background: minimal

## 8.9 Cancellations, Failures, And Returns

Requirements:

- Customer can cancel according to policy.
- Business can cancel according to policy.
- Admin can cancel with reason.
- Cancellation fee depends on delivery state.
- Failed delivery must enter support/admin workflow.
- Return may be required after pickup.
- Refund eligibility must be linked to cancellation/failure reason.
- All cancellations and returns must be audited.

Important cases:

- cancelled before rider assignment
- cancelled after rider assignment
- cancelled after pickup
- recipient unavailable
- address inaccessible
- damaged package
- restricted/prohibited item discovered
- rider unable to proceed

## 8.10 Admin Operations

Requirements:

- Admin can view live delivery board.
- Admin can filter by status, zone, rider, business, type, age, and exception state.
- Admin can view full delivery timeline.
- Admin can manually assign/reassign riders.
- Admin can cancel delivery with reason.
- Admin can trigger notifications.
- Admin can manage service zones.
- Admin can manage pricing rules.
- Admin can approve/suspend riders.
- Admin can approve/suspend businesses.
- Admin can view payment/refund state.
- Admin can manage support tickets.
- Admin can view audit logs.
- Admin can export reports.

## 8.11 Notifications

Requirements:

- Notifications are template-based.
- Notification attempts are logged.
- Critical events use push and optional SMS/WhatsApp.
- Notification retries must avoid duplicate critical messages.

Events:

- OTP requested
- delivery confirmed
- rider assigned
- rider arrived pickup
- pickup completed
- rider near drop
- delivered
- cancelled
- failed
- refund processed
- support ticket updated

## 8.12 Reports And Metrics

Requirements:

- Admin can view operational metrics.
- Finance can view revenue, refunds, rider earnings, business settlement, and contribution margin.
- Business can export delivery history.
- Rider can view earnings history.

Required reports:

- daily operations summary
- dispatch performance
- cancellation/failure analysis
- rider performance
- business delivery report
- payment reconciliation
- contribution margin report

## 9. Canonical States

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

## 10. Permissions

### Customer

- create own customer deliveries
- view own deliveries
- cancel own deliveries according to policy
- view own receipts/proofs
- open support tickets for own deliveries

### Rider

- view assigned/offered deliveries only
- update assigned delivery only through allowed actions
- submit proof for assigned delivery
- update own availability/location
- view own earnings
- report issue

### Business

- create business deliveries for approved business account
- view own business deliveries
- view own business proofs
- export own business reports
- manage approved pickup addresses if permitted

### Ops Admin

- manage delivery operations
- assign/reassign riders
- cancel deliveries with reason
- handle support tickets
- approve/suspend riders and businesses if permitted

### Finance Admin

- view payments, refunds, settlements, earnings, reports
- initiate or approve refunds according to policy
- cannot casually change operational delivery state unless explicitly granted

### Super Admin

- full system access
- manage admin users
- configure pricing, zones, roles, and policies

## 11. Policy Requirements

The following policies must exist before production:

- terms of service
- privacy policy
- delivery restrictions
- prohibited item list
- package size/weight/value limits
- cancellation policy
- refund policy
- failed delivery policy
- return policy
- business billing policy
- rider payout policy
- location retention policy
- proof/document retention policy
- support escalation policy

## 12. Non-Functional Requirements

### Security

- HTTPS everywhere.
- OTP rate limiting.
- Secure refresh tokens or server-side sessions.
- Role-based authorization.
- Object-level authorization.
- DTO/schema validation.
- Webhook signature verification.
- Signed URLs for private files.
- Immutable audit logs.
- PII minimization.
- Contact masking where possible.
- No card data storage.

### Reliability

- API and workers must have health checks.
- Background jobs must be idempotent.
- Payment reconciliation must handle duplicate/missing webhooks.
- Dispatch must recover from stale riders and failed offers.
- Database backups must be automated and restore-tested.

### Performance

- Quote response should be fast enough for interactive customer flow.
- Rider offer acceptance should be low-latency.
- Admin live board should remain usable during active operations.
- Location updates should be throttled and battery-conscious.

### Privacy

- Track rider location only for operational need.
- Limit raw location retention.
- Treat rider documents, customer addresses, proof images, and precise location as sensitive.
- Expose pickup/drop details by role and delivery state only when needed.

## 13. MVP Release Plan

### Phase 0: Foundation

Scope:

- monorepo
- environments
- CI
- auth/session basics
- database schema
- logging
- base admin shell

Exit criteria:

- apps build
- API deploys
- migrations run
- auth works in staging

### Phase 1: Core Delivery

Scope:

- addresses
- service zones
- quotes
- delivery creation
- `SEND`
- `BUSINESS_DELIVERY`
- delivery lifecycle

Exit criteria:

- customer/business can create priced delivery in staging

### Phase 2: Rider Workflow

Scope:

- rider onboarding
- admin approval
- availability
- offers
- pickup/drop workflow
- proof upload
- issue reporting

Exit criteria:

- rider can complete a delivery in staging

### Phase 3: Dispatch

Scope:

- eligibility filters
- offer timeout
- retry logic
- radius expansion
- transactional accept locking
- admin assignment fallback

Exit criteria:

- delivery can be assigned reliably and cannot be double-accepted

### Phase 4: Payments

Scope:

- payment provider integration
- quote-to-payment linkage
- webhook verification
- refunds
- reconciliation
- receipts

Exit criteria:

- paid delivery reconciles correctly and duplicate webhooks are safe

### Phase 5: Admin Operations

Scope:

- live board
- manual assignment
- pricing/zones
- support tickets
- cancellation/refund tooling
- reports
- audit logs

Exit criteria:

- operations team can run deliveries without developer intervention

### Phase 6: Hardening

Scope:

- security tests
- load tests
- monitoring
- alerting
- backup restore tests
- runbooks
- policies

Exit criteria:

- production readiness checklist is complete

## 14. Acceptance Criteria

### Customer

- Customer can log in.
- Customer can create `SEND`.
- Customer can create allowed `LIMITED_FETCH`.
- Customer can view quote before confirming.
- Customer can pay for delivery.
- Customer can track assigned delivery.
- Customer can cancel according to policy.
- Customer can view receipt and proof.

### Business

- Business can log in.
- Business must be approved before creating deliveries.
- Business can create delivery.
- Business can track active deliveries.
- Business can view proof.
- Business can export delivery history.

### Rider

- Rider can onboard.
- Rider cannot receive jobs before approval.
- Rider can go online/offline.
- Rider can accept/reject offers.
- Rider can complete required status flow.
- Rider cannot complete without required proof.
- Rider can report issue.
- Rider can view earnings.

### Admin

- Admin can view all active deliveries.
- Admin can identify unassigned/stuck deliveries.
- Admin can manually assign/reassign.
- Admin can cancel with reason.
- Admin can approve/suspend riders.
- Admin can approve/suspend businesses.
- Admin can view payments/refunds.
- Admin can view audit logs.

### System

- Two riders cannot accept the same delivery.
- Duplicate webhooks do not duplicate payment state.
- Historical quotes remain unchanged after pricing edits.
- Unauthorized users cannot access other users' deliveries.
- All sensitive admin actions are audited.
- Raw card data is never stored.

## 15. Critical Risks And Mitigations

### Risk: LIMITED_FETCH Becomes Uncontrolled Shopping

Mitigation:

- Limit `LIMITED_FETCH` to pre-arranged pickup only.
- Block rider payment, substitution, negotiation, and regulated item handling.
- Require customer confirmation that item is already paid or no payment is required.

### Risk: Dispatch Fails In Real Operations

Mitigation:

- Start with small service area.
- Use nearest eligible rider.
- Add timeout/retry.
- Add admin attention queue.
- Track assignment time and acceptance rate.

### Risk: Double Assignment

Mitigation:

- Use database transaction on accept.
- Enforce one accepted assignment per delivery.
- Make rider accept endpoint idempotent.

### Risk: Payment Reconciliation Errors

Mitigation:

- Use backend-created payment orders.
- Verify signatures/webhooks.
- Store webhook IDs.
- Make payment/refund operations idempotent.
- Build reconciliation report.

### Risk: Unit Economics Fail

Mitigation:

- Store revenue, rider payout, payment fee, refund, support cost, and maps/notification cost separately.
- Review contribution margin before scaling demand.
- Prefer business-heavy launch if consumer demand is too expensive.

### Risk: Privacy Or PII Exposure

Mitigation:

- Mask phone numbers.
- Limit address visibility by state and role.
- Use signed URLs.
- Define data retention policies.
- Audit sensitive admin actions.

## 16. Open Product Decisions

Freeze these before implementation:

- exact service zones
- delivery hours
- allowed/prohibited items
- max package size
- max package weight
- max declared value
- customer cancellation fees
- failed delivery handling
- return handling
- rider payout model
- business pricing model
- business prepaid vs invoiced/postpaid model
- proof requirements per delivery type
- location retention period
- rider active-job limit
- payment provider
- maps/geocoding provider
- SMS/WhatsApp provider
- support escalation SLA

## 17. Launch Readiness Checklist

- Customer can complete `SEND`.
- Business can create and track delivery.
- `LIMITED_FETCH` works without rider purchase handling.
- Rider can onboard, be approved, go online, accept, and complete job.
- Admin can manually assign and reassign rider.
- Automatic dispatch handles timeout/retry.
- Payment webhooks are verified and idempotent.
- Proof files are private and signed.
- Cancellation/refund rules work.
- Role boundaries are tested.
- Monitoring and alerts are active.
- Backup and restore are tested.
- Terms, privacy policy, delivery restrictions, and cancellation policy are ready.
- Operations runbooks exist for failed deliveries, disputes, and payment issues.
- Contribution margin reporting exists.
