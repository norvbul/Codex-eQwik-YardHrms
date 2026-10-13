# Deployment and rollback

The local Docker Compose file is for development. The application deployment template expects private managed MySQL, authenticated Redis, private S3, approved SMTP, a real ClamAV service and a managed HTTPS load balancer. It does not provision hosting, certificates, encryption policies or a production account.

## Build release artifacts

Pin the release to a reviewed commit and build all four targets:

```sh
export YARD_IMAGE_REGISTRY=your-approved-registry
export YARD_RELEASE=reviewed-commit-sha
bash scripts/build-images.sh
```

Reserve sufficient build/cache disk space; run image builds separately from browser/database checks in small cloud workspaces. The build copies application sources separately from deployment configuration and excludes nested node_modules, so documentation/configuration edits do not require a dependency rebuild.

The targets are API/worker, migration runner, HRMS web and Qwik web. The server image runs as a nonroot user with production dependencies; frontend images use unprivileged Nginx. Source `.env`, private archives, uploaded attachments, caches and Git data are excluded. No runtime credentials are baked into images.

In an environment with an approved TLS inspection proxy, set `YARD_BUILD_CA_BUNDLE` to its trusted CA bundle. BuildKit mounts it only during verified dependency downloads. Do not disable npm TLS verification, Prisma checksum validation or database certificate verification.

Push images through your approved release pipeline after tests and review. The provided build script creates local images and does not publish or deploy them.

## Configure secrets and services

Supply runtime configuration from a secret manager to an ignored file referenced by `YARD_RUNTIME_ENV_FILE`. Set:

- `NODE_ENV=production`; private application `DATABASE_URL`; `MYSQL_SSL=true`; trusted `MYSQL_SSL_CA` when needed.
- Exact HTTPS `APP_ORIGINS`, `HRMS_URL` and `QWIK_URL`, with separate origins for the portals.
- A protected `FIELD_ENCRYPTION_KEY` (32-byte hex), authenticated/TLS Redis URL and environment-specific `QUEUE_NAMESPACE`.
- Private HTTPS S3 endpoint/region/bucket and IAM credentials or workload identity. Enable bucket encryption, block public access, versioning and audited access.
- Approved SMTP host/port/from/authentication; production delivery requires TLS.
- `CLAMAV_HOST`/`CLAMAV_PORT` on the private network, current signed definitions, scanner monitoring and its own resource limits. Until configured, uploads remain quarantined.
- Owner-approved session timeout, PDF font path if different, backup configuration and retention policy.

Do not put migration credentials in runtime/worker secrets. Use a separate migration account with required DDL/trigger permissions. For native Prisma production migrations configure verified TLS in `MIGRATION_DATABASE_URL`, including the provider's trusted CA/strict acceptance parameters. MySQL binary logging requires appropriate trigger privileges; use your provider's managed equivalent, not a globally privileged API account.

MySQL uses InnoDB/UTF8MB4 and DECIMAL monetary fields. Redis must persist queues and rate limits. S3 must retain approved historical files independently of subscription expiry. Provision encrypted disks/backups and access logs through the provider.

## Stage and migrate

1. Restore a representative encrypted data copy into staging and run the full test/acceptance matrix. Configure real provider integrations and approved statutory vectors there.
2. Back up and verify restore before schema deployment. Native `prisma migrate deploy` applies versioned migrations; do not use `db push` or edit completed migration history.
3. Run the dedicated migration image with migration-only secrets and any mounted trusted CA. Run the idempotent seed only through a reviewed operator command to establish permissions/catalogue defaults. Seeding preserves configured paid prices and does not create customer users or statutory packages.
4. Start API/worker and both web services using `infra/deployment/compose.application.yml` behind HTTPS. Its web listeners are loopback-bound for an on-host load balancer. API/database/Redis/storage must not be exposed publicly.
5. Nginx forwards client address headers to the API. Configure Nginx real-IP handling for **only** the trusted load-balancer CIDRs so distributed rate limiting sees actual client addresses. Do not trust arbitrary public forwarded headers. The API trusts the single protected Nginx hop.
6. Verify health, invite an authorized operator securely, test email/MFA, private storage/scanning, capacity and tenant boundaries, reference payroll and renewal/expiry. Observe queue failures, latency, storage integrity and migrations.
7. Obtain payroll/legal, security, representative customer and owner UAT sign-off before production cutover.

## Monitoring and recovery

Alert on health/readiness failures, API error/request IDs, Redis/worker failures, overdue approved configuration changes, failed/unavailable malware scanning, capacity overages and renewal queues. Keep logs free of passwords, tokens, bank fields and document contents. Export security/audit events to immutable external retention through an approved operator pipeline.

Deploy the previous application image to reverse an application-only regression if compatible with the current schema. Schema rollback is a planned forward fix or a tested restore; never erase approved payroll or manually rewrite migration history. Restore an encrypted predeployment database, private objects and field-encryption keys into an isolated replacement, reconcile, then perform an approved traffic cutover. Define RPO/RTO and quarterly recovery exercises before launch.

Availability, production TLS/provider configuration, realistic load targets and externally operated recovery are deployment acceptance items; successful local builds do not certify them.
