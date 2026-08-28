# Deployment Notes

V1 deployment shape:

- Web apps on Vercel or equivalent.
- API and workers as managed containers.
- PostgreSQL, Redis, and object storage as managed services.

The API must remain stateless. Workers should scale separately from API instances.

Required production configuration:

- `DATABASE_URL`
- `REDIS_URL`
- JWT/session secrets
- payment provider credentials
- maps provider credentials
- notification provider credentials
- object storage bucket and credentials
