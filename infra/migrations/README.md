# Database Migrations

Prisma schema lives at:

```text
packages/database/prisma/schema.prisma
```

Local workflow:

```bash
docker compose up -d postgres redis
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:15432/local_delivery"
npm --workspace packages/database run prisma:generate
npm --workspace packages/database run prisma:push
npm --workspace packages/database run prisma:seed
```

Production should use reviewed migrations, not ad-hoc `db push`.
