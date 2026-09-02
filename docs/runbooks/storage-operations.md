# Storage Operations Runbook

Status: v1 draft for local build and operations testing.

## Purpose

Use this runbook when proof uploads, signed proof reads, rider document uploads, or signed rider document reads fail.

## Expected Behavior

1. Proof and rider document files use private object keys.
2. Clients request short-lived signed upload URLs from the API.
3. Clients upload directly to the configured object storage provider or local mock upload endpoint.
4. Clients submit the private object key to the backend action endpoint.
5. Authorized reads return sanitized metadata and short-lived signed read URLs.
6. Expired proof/document file refs are cleaned up according to retention policy.

## Health Signals

Check:

```http
GET /api/v1/health
GET /api/v1/health/metrics
```

Storage-related trigger:

```text
storage.degraded
```

This means S3-compatible storage mode is requested but required endpoint, bucket, or credentials are missing.

## Recovery Steps

1. Confirm `OBJECT_STORAGE_PROVIDER` is `mock-s3-compatible`, `s3-compatible`, or `s3`.
2. For provider mode, verify endpoint, bucket, region, access key, and secret key environment variables.
3. Confirm bucket policy keeps objects private.
4. Confirm bucket CORS allows only approved app origins and methods required for signed PUT/GET.
5. Request a new signed upload URL because old upload URLs expire quickly.
6. Check API structured logs for request ID, path, status code, and latency.
7. Check worker logs for retention cleanup failures.
8. If proof is missing and delivery completion is blocked, keep delivery in support/admin workflow until valid proof is submitted or an audited admin policy decision is made.

## Escalation

Escalate to engineering if:

- signed URLs are generated but provider rejects them
- bucket CORS blocks approved clients
- private object keys are exposed in normal read responses
- retention cleanup removes records instead of only removing file refs
- storage errors coincide with delivery completion failures
