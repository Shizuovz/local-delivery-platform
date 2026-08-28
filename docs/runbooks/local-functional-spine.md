# Local Functional Spine Runbook

This runbook exercises the first real workflow once dependencies are installed and the API is running.

## Start

```bash
npm install
npm run dev:api
```

API base URL:

```text
http://localhost:4000/api/v1
```

## Seeded Users

The in-memory store seeds:

- admin phone: `+910000000001`
- rider phone: `+910000000002`

Use OTP code:

```text
123456
```

Create a customer by verifying OTP for any other phone number.

## Workflow

1. Customer requests and verifies OTP.
2. Customer creates a `SEND` quote.
3. Customer creates delivery from quote with an idempotency key.
4. Customer confirms mock payment through `/payments/mock/confirm`.
5. Mock payment confirmation triggers dispatch.
6. Seeded rider loads offers and accepts assignment.
7. Rider runs pickup and drop actions.
8. Rider completes delivery with OTP `123456`.
9. Admin loads delivery timeline.

## Minimal UIs

- Customer mobile: `npm run dev:customer`
- Rider mobile: `npm run dev:rider`
- Admin web: `npm run dev:admin`

The screens are intentionally plain. They exist to validate workflow behavior before final design-system work.

## Dispatch Modes

Default local mode dispatches inline after mock payment confirmation. This is fastest for UI workflow testing.

Queued dispatch mode uses Redis/BullMQ:

```bash
$env:DISPATCH_QUEUE_MODE="bullmq"
$env:REDIS_URL="redis://localhost:16379"
npm run dev:api
```

In a second terminal:

```bash
$env:DISPATCH_QUEUE_MODE="bullmq"
$env:REDIS_URL="redis://localhost:16379"
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:15432/local_delivery"
$env:PERSISTENCE_MODE="prisma"
npm run worker:dispatch
```

Queued dispatch should still keep PostgreSQL as the source of truth. BullMQ job payloads should contain IDs only.

## Prisma/PostgreSQL Mode

The functional spine currently defaults to in-memory mode so tests and UI workflow checks stay fast.

To validate the real PostgreSQL boundary:

```bash
docker compose up -d postgres redis
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:15432/local_delivery"
$env:PERSISTENCE_MODE="prisma"
npm --workspace packages/database run prisma:generate
npm --workspace packages/database run prisma:push
npm --workspace packages/database run prisma:seed
npm run dev:api
```

Then check:

```text
GET http://localhost:4000/api/v1/health
```

Expected persistence mode:

```json
{
  "mode": "prisma",
  "connected": true
}
```
