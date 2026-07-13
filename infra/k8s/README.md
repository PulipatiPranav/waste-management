# Kubernetes manifests

Phase 0 provides the **shape** of the deployment, not a deployable environment.
`base/` holds manifests that are structurally valid and can be linted in CI, with
`kustomize` overlays per environment.

Phase 15 completes this: image tags wired to the CI build, HPA tuning against real
load numbers, BullMQ worker Deployments, a controlled `prisma migrate deploy` job,
an ingress, and an external secrets operator.

## Layout

```
base/            environment-independent manifests
  namespace.yaml
  api-deployment.yaml
  api-service.yaml
  api-config.yaml       non-secret config (ConfigMap)
  api-secret.example.yaml   SHAPE ONLY — never contains real values
overlays/
  staging/
  production/
```

## Secrets

`api-secret.example.yaml` documents which keys the API expects. It is an example,
in the same spirit as `.env.example` — **never** commit a manifest containing a real
secret value, base64 or otherwise. Base64 is an encoding, not encryption: anything
in a committed Secret manifest is public.

Phase 15 replaces it with a real secret source (External Secrets Operator or the
cloud provider's secret manager).

## Rendering

```bash
kubectl kustomize infra/k8s/overlays/staging
```
