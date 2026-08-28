# Agent Instructions

This project is a controlled local delivery platform. Agents working in this repository must preserve the product decision: build a logistics operating system, not a broad marketplace clone.

## Source Of Truth

Read these files before making product, architecture, or implementation decisions:

1. `architecture-essentials.md`
2. `architecture.md`
3. `system-design.md`
4. `PRD.md`

If these files disagree, follow `architecture-essentials.md` for non-negotiables, then `architecture.md` for technical architecture, then `system-design.md` for runtime/internal behavior, then `PRD.md` for product behavior.

## Product Boundaries

V1 includes:

- `SEND`: customer sends an item from pickup to drop.
- `BUSINESS_DELIVERY`: approved businesses create deliveries for customers.
- `LIMITED_FETCH`: pickup from a known source where the item and payment are already arranged.

V1 excludes:

- rider-funded purchases
- food marketplace
- open shop discovery
- wallet or stored-value system
- subscriptions or loyalty
- dark stores
- route optimization
- product substitution
- inventory or catalog management
- broad marketplace behavior

Do not add excluded features unless the user explicitly changes the product scope and the architecture/PRD are updated first.

## Engineering Principles

- Backend is the source of truth for delivery state, assignment state, payment state, refund state, quotes, proof, permissions, and financial records.
- Clients submit actions; clients never set arbitrary status, price, payment success, or proof validity.
- Use a modular monolith for v1. Do not introduce microservices unless the architecture is explicitly revised.
- Use PostgreSQL for transactional data. Do not replace it with MongoDB for core delivery/payment/assignment flows.
- Store money in integer minor units, such as paise. Never use floating point for financial values.
- Use UUIDs for public identifiers.
- Every important state change must be auditable.
- Every financial operation must be idempotent.
- Every protected read/write must enforce role-based and object-level authorization.
- Admin override is a required recovery mechanism, not an optional enhancement.

## Canonical Stack

Preferred stack:

- Mobile: React Native + Expo
- Business/Admin web: Next.js + TypeScript
- Backend: NestJS + TypeScript
- Database: PostgreSQL + Prisma
- Queue/cache: Redis + BullMQ
- Storage: S3-compatible object storage
- Maps: Google Maps Platform or Mapbox
- Payments: Razorpay or equivalent
- Notifications: FCM plus SMS/WhatsApp for critical events
- Monitoring: Sentry, structured logs, health checks, alerts

Follow existing project conventions once implementation files exist.

## Canonical State Machines

Use these states exactly unless the architecture is updated.

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

## Dispatch Rules

V1 dispatch is nearest eligible rider with timeout, retry, radius expansion, and admin fallback.

Rider eligibility requires:

- approved profile
- online status
- not suspended
- fresh location
- suitable vehicle/package capability
- inside service zone or radius
- active-job limit not exceeded

Assignment acceptance must be transactional. The database must enforce only one accepted assignment per delivery.

## Payment Rules

- Customer deliveries are prepaid by default.
- Approved businesses may be prepaid or invoiced/postpaid.
- No wallet in v1.
- No rider-funded purchase flow in v1.
- Never store card data.
- Create quote snapshots before payment.
- Verify payment signatures and webhooks on the backend.
- Use idempotency keys for payment order creation, delivery confirmation, refunds, and webhook handling.
- Refunds are backend/admin initiated only.

## LIMITED_FETCH Rules

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

## Security And Privacy Rules

- Use HTTPS everywhere.
- Rate-limit OTP, quote, login, order creation, and location endpoints.
- Use secure refresh tokens or server-side sessions.
- Enforce role-based authorization.
- Enforce object-level authorization.
- Validate all inputs with DTO/schema validation.
- Verify webhooks with provider signatures.
- Use signed URLs for private proof/document files.
- Minimize PII exposure.
- Mask contact details where possible.
- Treat exact location, rider documents, customer addresses, and proof files as sensitive.
- Define and honor retention rules for documents, proof photos, and location data.

## Admin And Operations

Admin capabilities are core product requirements:

- live delivery board
- unassigned/admin attention queue
- delivery timeline
- manual assign/reassign
- cancellation with reason
- rider approval/suspension
- business approval/suspension
- pricing and service-zone config
- payment/refund monitoring
- support/dispute handling
- audit log viewer
- operational reports

Sensitive admin actions must capture reason and create audit logs.

## Frontend Guidance

Design should serve operations first.

- Customer UI can be friendly and warm.
- Rider UI must be fast, high-contrast, and usable outdoors/on the move.
- Admin and business UI must be dense, calm, and operational.
- Avoid decorative glassmorphism in critical workflows.
- Avoid overly large radii in admin/business dashboards.
- Use clear semantic status colors for assigned, searching, delayed, cancelled, failed, paid, refund pending, and disputed.
- Do not hide critical delivery/payment/rider information behind decorative layouts.

## Testing Expectations

At minimum, implementation work should protect these cases:

- customer cannot view another customer's delivery
- business cannot view another business's delivery
- rider cannot update unassigned delivery
- delivered delivery cannot move backward
- client cannot fake payment success
- two riders cannot accept the same delivery
- duplicate payment webhooks are idempotent
- duplicate order creation is prevented
- cancelled delivery cannot be charged again
- expired OTP cannot authenticate
- pricing changes do not alter historical quotes
- stale-location rider is not eligible
- suspended rider cannot receive or accept offers
- required proof is enforced before completion
- failed delivery enters support/admin workflow

When adding code, add or update tests according to risk and blast radius.

## File And Change Discipline

- Keep changes aligned with `architecture-essentials.md`, `architecture.md`, and `PRD.md`.
- Update the docs when product or architecture decisions change.
- Prefer focused, incremental changes.
- Avoid unrelated refactors.
- Do not introduce dependencies without a clear need.
- Do not commit secrets, provider keys, customer data, rider documents, proof files, or local environment files.
- Preserve existing user changes in the worktree.

## Pre-Build Decisions

Do not treat these as solved until explicitly documented:

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
