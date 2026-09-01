# Project Context

Last updated: 2026-09-01

## What This Project Is

This is a controlled local delivery platform. The product goal is a reliable logistics operating system, not a broad marketplace clone.

V1 supports:

- `SEND`: a customer sends an item from pickup to drop.
- `BUSINESS_DELIVERY`: an approved business creates a delivery for a customer.
- `LIMITED_FETCH`: pickup from a known source where the item and payment are already arranged.

V1 excludes:

- rider-funded purchases
- food marketplace behavior
- open shop discovery
- wallet or stored-value flows
- subscriptions or loyalty
- dark stores
- route optimization
- product substitution
- inventory or catalog management

## Source Of Truth

Read these files before product, architecture, or implementation decisions:

1. `architecture-essentials.md`
2. `architecture.md`
3. `system-design.md`
4. `PRD.md`
5. `docs/api/README.md`
6. `docs/policies/*.md`
7. `docs/runbooks/*.md`

If docs disagree, follow `architecture-essentials.md` first.

## Current Build State

The functional prototype spine is implemented and verified against the real Prisma/PostgreSQL API.

Completed:

- TypeScript monorepo foundation.
- NestJS API modular monolith.
- Prisma/PostgreSQL persistence.
- Docker-backed local Postgres and Redis.
- Next.js admin web app.
- Next.js business web app.
- Expo customer mobile app scaffold.
- Expo rider mobile app scaffold.
- Shared packages for types, validation, config, utils, UI, and database.
- Dev OTP login flow.
- Customer `SEND` quote and delivery creation.
- Customer `LIMITED_FETCH` quote and delivery creation.
- Business `BUSINESS_DELIVERY` creation and detail loading.
- Mock prepaid payment confirmation.
- Signed mock payment webhook handling.
- Idempotent payment event storage.
- Basic cancellation/refund reconciliation.
- Direct dispatch by default.
- Redis/BullMQ queued dispatch behind `DISPATCH_QUEUE_MODE=bullmq`.
- Rider offer loading, accept, reject, and lifecycle actions.
- Pickup/drop delivery state transitions.
- Proof requirement enforcement before completion.
- Sanitized proof metadata.
- Short-lived signed proof file URLs.
- Admin delivery board, timeline, assign, reassign, exception marking, cancellation, refund visibility, rider controls, business controls, support tickets, and audit logs.
- Local reset workflow through `npm run db:reset`.
- Cache policy and Redis-backed admin operations report.
- Admin dashboard operations metrics.

## Verified Workflows

Verified with Prisma/PostgreSQL:

- Business web loads profile, creates `BUSINESS_DELIVERY`, and loads delivery detail.
- Admin web assigns rider, reassigns rider, marks exception, cancels delivery, shows refund visibility, and creates support ticket.
- Customer mobile API path creates quote, creates delivery, confirms payment webhook, tracks delivery, and views proof metadata.
- Rider mobile API path receives offer, accepts, moves through pickup/drop, completes proof, and loads earnings.

Validation commands recently passed:

```bash
npm run typecheck
npm run lint
npm --workspace apps/api run test
```

## Current Git State

Latest pushed commits:

```text
6a49c21 Add local database reset workflow
053e1ec Harden admin workflow and proof access
9b2445d Harden payments refunds and admin operations
5bbb325 Add limited fetch delivery spine
dc768a5 Add business delivery spine
675b8b0 Initialize local delivery platform
```

As of this context file, local `main` was clean and synced with `origin/main`.

## Important Technical Rules

- Backend is the source of truth for delivery state, assignment state, payment state, refund state, quote snapshots, proof validation, permissions, and financial records.
- Clients submit actions. Clients must not set arbitrary delivery status, payment success, price, or proof validity.
- Use PostgreSQL as the transactional source of truth.
- Use Redis/BullMQ for queues, dispatch retries, rate limits, short-lived state, and safe cache where appropriate.
- Store money in integer minor units.
- Use UUIDs for public identifiers.
- Keep quote snapshots immutable after confirmation.
- Record important delivery state transitions in `delivery_status_history`.
- Enforce one accepted assignment per delivery at the database level.
- Sensitive admin, financial, proof, and state changes must be audited.
- Proof/document files must be private and served through signed URLs.
- Exact location, addresses, rider documents, and proof files are sensitive.

## Local Development

Start dependencies:

```bash
docker compose up -d postgres redis
```

Run API in Prisma mode:

```bash
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:15432/local_delivery"
$env:PERSISTENCE_MODE="prisma"
$env:REDIS_URL="redis://localhost:16379"
npm run dev:api
```

Run web apps:

```bash
npm run dev:admin
npm run dev:business
```

Reset noisy local verification data:

```bash
npm run db:reset
```

Use `db:reset` only for local development databases.

## Known Remaining Work

Not yet implemented:

- Real payment provider integration.
- Real payment provider refund API calls.
- S3-compatible private object key abstraction with local mock signed uploads.
- Signed proof upload URL endpoint.
- Signed rider document URLs for rider/admin views.
- Retention cleanup service/job for proof and rider document file refs.
- Provider-backed S3 streaming remains to be added when storage provider is selected.
- Full pricing/service-zone admin configuration.
- Full admin reports and payment/refund monitoring screens.
- Business delivery reports/export.
- Production observability: metrics, alerts, dashboards, and runbook triggers.
- Production readiness checklist.

Pre-build decisions still need final policy choices:

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

## Recommended Next Step

Current build slice: caching strategy plus operational reporting foundation.

Recommended scope:

Completed in this slice:

1. Create `docs/policies/cache-policy.md`.
2. Implement safe Redis cache helpers.
3. Add `GET /api/v1/admin/reports/operations`.
4. Add initial admin metrics:
   - active deliveries
   - searching rider
   - assigned
   - delivered today
   - cancelled today
   - refund pending
   - open support tickets
   - stale dispatch/admin attention
5. Wire those metrics into the admin dashboard.

Current recommended slice after storage verification: provider-backed file streaming/upload integration or production observability hardening, depending on whether the storage provider has been selected.
