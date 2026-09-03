# Project Decisions

Last updated: 2026-09-02

This file records important product and engineering decisions for the local delivery platform. It does not replace `architecture-essentials.md`, `architecture.md`, `system-design.md`, or `PRD.md`; it summarizes the decisions that should guide day-to-day build work.

## Decision Sources

Decision priority:

1. `architecture-essentials.md`
2. `architecture.md`
3. `system-design.md`
4. `PRD.md`
5. `docs/policies/*.md`
6. `docs/runbooks/*.md`
7. implementation notes in this file

If a decision changes, update the source-of-truth document first, then update this file.

## Confirmed Product Decisions

### Build A Controlled Logistics Platform

Decision: Build a delivery operations platform, not a broad marketplace.

Reason: The main risk is operational reliability, not catalog breadth. V1 must prove that deliveries can be priced, assigned, tracked, completed, reconciled, and recovered by admins.

Implication:

- Prioritize dispatch, proof, payments, admin control, and support recovery.
- Do not add food ordering, shop discovery, wallet, catalog, substitution, or rider-funded shopping in v1.

### V1 Delivery Types

Decision: V1 supports only:

- `SEND`
- `BUSINESS_DELIVERY`
- narrow `LIMITED_FETCH`

Reason: These are enough to validate local logistics without becoming a marketplace.

Implication:

- `LIMITED_FETCH` must remain pre-arranged pickup only.
- Riders must not pay merchants, negotiate, choose substitutes, or handle restricted-goods judgment.

### Functional Spine First

Decision: Build the functional spine before final design polish.

Reason: The highest risk is whether the workflows are correct under real state, payment, proof, dispatch, and admin-recovery rules.

Implication:

- Minimal UI is acceptable until workflows are proven.
- UI must call real APIs where possible.
- Final design system work comes after the spine is operationally credible.

## Confirmed Architecture Decisions

### Modular Monolith For V1

Decision: Use a NestJS modular monolith for the backend.

Reason: V1 needs transactional correctness and speed of iteration more than distributed-service complexity.

Implication:

- Do not introduce microservices unless architecture docs are revised.
- Keep modules clean enough to split later if traffic or ownership requires it.

### PostgreSQL Is Source Of Truth

Decision: PostgreSQL with Prisma is the transactional source of truth.

Reason: Delivery, assignment, payment, refund, proof, and audit behavior require relational constraints and transactions.

Implication:

- Do not replace core state with MongoDB or Redis.
- Redis can assist with timing, queues, short-lived state, rate limits, and cache, but cannot own critical delivery truth.

### Backend Owns Critical State

Decision: Clients submit actions; backend owns state transitions and validation.

Reason: Client-set status/payment/proof values would create fraud, race, and support risks.

Implication:

- Use action endpoints such as accept, picked-up, delivered, cancel, assign, and reassign.
- Do not expose generic arbitrary status setters.
- Payment success must come from backend-confirmed provider/webhook behavior.

### Redis And BullMQ Are Supporting Infrastructure

Decision: Use Redis/BullMQ for dispatch queues, retries, offer timing, rate limits, short-lived state, and safe caching.

Reason: Dispatch timing and operational dashboards need fast coordination, but correctness still belongs in PostgreSQL.

Implication:

- Queue payloads should contain IDs only.
- Workers must reload current state from PostgreSQL before acting.
- Cache entries must have explicit TTL and invalidation rules.

### Pricing And Zones Are Admin-Managed

Decision: Pricing rules and service zones are stored in backend configuration and managed by admins, not hardcoded in delivery services.

Reason: Quotes must reflect operational policy, serviceability, and launch economics without requiring developer changes.

Implication:

- New quotes load active pricing rules from PostgreSQL/in-memory config.
- Zone-specific pricing wins over default delivery-type pricing.
- Historical quote snapshots remain unchanged after config edits.
- Service-zone and pricing changes require an admin reason and audit log.

## Confirmed Data Decisions

### UUID Public IDs

Decision: Use UUIDs for public identifiers.

Reason: Public sequential IDs leak volume and are easier to enumerate.

### Integer Minor Units For Money

Decision: Store all money in integer minor units.

Reason: Floating point money creates rounding and reconciliation errors.

### Immutable Quote Snapshots

Decision: Quote snapshots become immutable after delivery confirmation.

Reason: Historical deliveries must not change when pricing rules change later.

### One Accepted Assignment Per Delivery

Decision: Enforce one accepted assignment per delivery at the database level.

Reason: Two riders accepting the same delivery is a core operational failure.

### Audit Critical Changes

Decision: Audit admin, financial, proof, and sensitive state changes.

Reason: Operations needs accountability for recovery, disputes, support, and financial reconciliation.

## Confirmed Security And Privacy Decisions

### Proof Files Are Private

Decision: Proof and document files must not be public bucket URLs.

Reason: Proof photos, signatures, identity documents, addresses, and precise locations are sensitive.

Implication:

- API responses must return sanitized proof metadata.
- File access must use short-lived signed URLs.
- Real object storage integration must preserve this behavior.

### Object-Level Authorization Is Required

Decision: Role checks are not enough; object ownership checks are required.

Reason: A customer, rider, or business user may have the right role but still not own a specific delivery.

Implication:

- Customers access only their deliveries.
- Riders access only offered/assigned/historical jobs they are allowed to see.
- Businesses access only their business deliveries.
- Admins access according to operational role.

### Rate Limits Are Product Requirements

Decision: Rate-limit OTP, auth, quote/order creation, payment/webhook simulation, rider actions, admin actions, and location endpoints where appropriate.

Reason: Abuse or accidental retry storms can hurt operations and cost.

## Confirmed Operations Decisions

### Admin Override Is Core

Decision: Admin assignment, reassignment, cancellation, exception marking, rider/business controls, support tickets, refunds, and audit logs are required v1 behavior.

Reason: Local delivery operations will fail without human recovery paths.

### Local Reset Must Be Explicit

Decision: Normal seed is non-destructive; local destructive reset uses `npm run db:reset`.

Reason: Seed should not wipe data unexpectedly, but verification needs a clean local database when test data accumulates.

## Decisions Still Open

These are not frozen yet and should be decided before production launch:

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
- proof/document retention period
- support escalation process
- initial rider active-job limit
- payment provider
- maps/geocoding provider
- SMS/WhatsApp provider

## Next Decision To Make

Current decision area: checkout handoff and reconciliation cadence.

Provider-backed S3 storage, admin-managed pricing/service-zone configuration, and Razorpay-compatible payment provider integration are now covered by the implementation plan. The next launch-risk decisions are how the customer app opens Razorpay checkout, how often payment reconciliation runs, and how finance reports should represent provider fees, settlements, refunds, and contribution margin.
