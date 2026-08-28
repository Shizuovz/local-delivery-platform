# Local Delivery Platform

Functional-spine-first local delivery platform for `SEND`, `BUSINESS_DELIVERY`, and narrow `LIMITED_FETCH`.

Read these first:

1. `architecture-essentials.md`
2. `architecture.md`
3. `system-design.md`
4. `PRD.md`
5. `AGENTS.md`

## Current Build Strategy

Start with the smallest real loop:

```text
customer quote -> delivery -> mock payment -> dispatch -> rider accept -> pickup -> delivery proof -> delivered -> admin timeline
```

The UI is intentionally minimal until the workflow and backend rules are correct.

## Local Persistence

The API defaults to in-memory mode for the functional spine. To validate PostgreSQL/Prisma mode:

```bash
docker compose up -d postgres redis
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:15432/local_delivery"
$env:PERSISTENCE_MODE="prisma"
npm run db:generate
npm run db:push
npm run db:seed
npm run dev:api
```

Health check:

```text
GET http://localhost:4000/api/v1/health
```

## Optional Queued Dispatch

Inline dispatch is the default for fast local workflow testing. To exercise Redis/BullMQ dispatch:

```bash
$env:DISPATCH_QUEUE_MODE="bullmq"
$env:REDIS_URL="redis://localhost:16379"
npm run worker:dispatch
```

Run the API with the same `DISPATCH_QUEUE_MODE` and `REDIS_URL` values. Keep `PERSISTENCE_MODE="prisma"` when validating queue behavior against PostgreSQL.
