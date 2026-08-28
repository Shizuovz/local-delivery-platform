# Local Docker Services

This project uses Docker for local PostgreSQL and Redis.

Start services:

```bash
docker compose up -d postgres redis
```

Stop services:

```bash
docker compose down
```

Reset local data:

```bash
docker compose down -v
```

Default local URLs:

- PostgreSQL: `postgresql://postgres:postgres@localhost:15432/local_delivery`
- PostgreSQL host port: `15432` by default
- Redis: `redis://localhost:16379`
- Redis host port: `16379` by default

Queued dispatch uses Redis through BullMQ when `DISPATCH_QUEUE_MODE=bullmq`.

Worker command:

```bash
npm run worker:dispatch
```

Do not use Docker volumes for production data.
