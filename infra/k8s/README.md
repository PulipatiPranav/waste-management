# Kubernetes manifests

Kustomize base + per-environment overlays for the whole platform: the API, the BullMQ
worker, Redis, the admin console, autoscaling, ingress, and the controlled DB migration.

## Layout

```
base/
  namespace.yaml
  api-config.yaml            shared non-secret config (ConfigMap) — API + worker
  api-deployment.yaml        the HTTP API (scheduling OFF)
  api-service.yaml
  worker-config.yaml         overrides that turn job SCHEDULING on
  worker-deployment.yaml     the BullMQ worker (sole scheduler; dedicated job capacity)
  redis.yaml                 in-cluster Redis (StatefulSet + Service); managed preferred in prod
  admin-deployment.yaml      the Next.js ops console (Deployment + Service)
  ingress.yaml               api.<host>/api and admin.<host>/  (TLS via cert-manager)
  hpa.yaml                   HorizontalPodAutoscaler for api + worker
  pdb.yaml                   PodDisruptionBudgets
  kustomization.yaml
  # NOT in the kustomization, on purpose:
  api-secret.example.yaml        documents the Secret keys; real values come from ESO
  external-secrets.example.yaml  External Secrets Operator shape (SecretStore/ExternalSecret)
  migrate-job.yaml               one-shot `prisma migrate deploy`, run by CI as a separate step
overlays/
  staging/     1 replica each, debug logs, *.staging.<host>
  production/  3 api / 2 worker / 2 admin, OTEL on, <host>
```

## The API / worker split

Both Deployments run the **same image**. The difference is configuration:

- **API** (`cpe-api-config`): job _scheduling_ flags are `false`, so no replica registers the
  nightly crons — that fixes the "every replica schedules" duplication.
- **Worker** (`cpe-worker-config` layered on top): the same flags are `true`, so exactly one
  process schedules the repeatable jobs.

Both pods still _consume_ jobs (BullMQ hands each job to a single consumer), so nothing is lost.
The worker Deployment exists to give background work dedicated, independently autoscaled capacity.

## Secrets — never committed

`api-secret.example.yaml` documents the keys. Real values come from the **External Secrets
Operator** (`external-secrets.example.yaml`) reading a cloud secret manager, or — for a throwaway
cluster — an imperative `kubectl create secret` (see the example header). Base64 is an encoding,
not encryption: a value committed in a Secret manifest is a leaked credential.

The env schema refuses to boot in production without a real `JWT_ACCESS_SECRET`, a non-default
`PAYMENT_WEBHOOK_SECRET`, and real providers — so a half-filled Secret fails fast at startup.

## Rendering & applying

```bash
# Render (what CI does before applying):
kubectl kustomize infra/k8s/overlays/staging

# Apply (CI does this with the release image tag patched in):
kubectl apply -k infra/k8s/overlays/staging
```

Migrations are **not** applied by `kubectl apply -k` — the deploy workflow runs `migrate-job.yaml`
as a separate, gated step and waits for it before rolling out the app. See
[`docs/runbook.md`](../../docs/runbook.md).

## Known follow-ups

- **Worker autoscaling should key off queue depth, not CPU** — add KEDA's `redis` scaler
  (a `ScaledObject` on the BullMQ list length). CPU HPA is the honest stopgap.
- **Managed Redis** is preferred over `redis.yaml` in production (failover, backups, patching).
- **Real SMS + S3-compatible storage providers** must be implemented before the API boots in
  `NODE_ENV=production` — the schema only ships dev stubs today and refuses them in prod.
