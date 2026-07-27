# Go-live roadmap — from repo to app stores

Everything you need to do to take this codebase to real users installing from the Play Store and
App Store. The code and pipelines exist (Phases 1–15); this is the **operator checklist** to stand
up the accounts, infrastructure and store listings around them.

Ordered by dependency. **Steps A0 and E3 are the two hard blockers** — one engineering, one legal —
so start those first; everything else is provisioning.

Legend: 🧑‍💻 code change · ☁️ infra/account · 🔑 secret · 📱 store · ⚖️ legal

---

## A. Prerequisites (do first — these block a production boot)

**A0. 🧑‍💻 Implement the two remaining real providers.** The API **refuses to boot in
`NODE_ENV=production`** with the dev stubs, and only stubs exist for these two:

- **SMS** — add a real provider (MSG91 or Twilio) as an `SmsProvider` implementation and add its
  name to the `SMS_PROVIDER` enum in `apps/api/src/config/env.schema.ts`. Without this, no OTP is
  delivered and the app can't be logged into.
- **Storage** — add an S3-compatible `StorageProvider` (AWS S3, Cloudflare R2, GCS) and add its name
  to the `STORAGE_PROVIDER` enum. Without this, delivery proof photos have nowhere durable to live.
- Payment (`razorpay`) and push (`fcm`) providers **already exist** — they only need credentials.

**A1. ☁️ Open the accounts you'll need:**

| Account                                         | For                                              | Cost            |
| ----------------------------------------------- | ------------------------------------------------ | --------------- |
| Cloud provider (EKS / GKE / AKS / DigitalOcean) | Kubernetes, managed Postgres + Redis             | usage           |
| Domain + DNS                                    | `api.` and `admin.` hostnames                    | ~₹1k/yr         |
| Razorpay                                        | payments + webhook secret                        | txn fees        |
| MSG91 / Twilio                                  | OTP SMS                                          | per SMS         |
| Firebase (FCM) + Apple (APNs)                   | push notifications                               | free / dev acct |
| Sentry                                          | error reporting (3 projects: api, admin, mobile) | free tier ok    |
| **Google Play Console**                         | Android distribution                             | **$25 once**    |
| **Apple Developer Program**                     | iOS distribution                                 | **$99 / year**  |

---

## B. Provision the backend infrastructure

**B1. ☁️ Kubernetes cluster** — a managed one (don't self-manage the control plane). Install:

- an **ingress controller** (nginx-ingress),
- **cert-manager** with a `letsencrypt-prod` ClusterIssuer (the Ingress annotations already point at
  it) for automatic TLS.

**B2. ☁️ Managed Postgres + Redis** (recommended over self-hosting the stateful pieces — you want
automated backups/PITR). If you use in-cluster Redis for staging, `infra/k8s/base/redis.yaml` is
ready; for production, delete it from the kustomization and point `REDIS_HOST/PORT/PASSWORD` at the
managed endpoint.

**B3. ☁️🔑 DNS + secrets manager.**

- Point `api.example.com` and `admin.example.com` (and the `*.staging.` variants) at the ingress LB.
- Put the real secret values into your cloud secret manager, then install the **External Secrets
  Operator** and apply a real version of `infra/k8s/base/external-secrets.example.yaml`. Or, for a
  quick start, create the Secret imperatively (see `api-secret.example.yaml` header). The full key
  list is in that file: `DATABASE_URL`, `REDIS_PASSWORD`, `JWT_ACCESS_SECRET` (`openssl rand -base64
48`), `PAYMENT_WEBHOOK_SECRET`, `RAZORPAY_KEY_ID/SECRET`, `FCM_SERVICE_ACCOUNT_JSON`, and
  optionally `SENTRY_DSN`.

**B4. ☁️ Update the hostnames/emails** in the overlays and Ingress (`example.com` → your domain) and
the `CORS_ORIGINS` in `api-config.yaml`.

**B5. ☁️ (Optional but recommended) Observability stack:** deploy an OpenTelemetry Collector,
Prometheus + Grafana (scrape `/metrics` in-cluster), and create the 3 Sentry projects. Production
already sets `OTEL_ENABLED=true`; point `OTEL_EXPORTER_OTLP_ENDPOINT` at your collector.

---

## C. Wire up CI/CD

**C1. 🔑 GitHub Environments** (repo → Settings → Environments):

- `staging` — no gate.
- `production` — **add required reviewers** (this is the manual approval gate).
- `play-internal` and `appstore-internal` — **add required reviewers** (the mobile promotion gates).

**C2. 🔑 GitHub secrets & variables:**

- Secrets: `KUBE_CONFIG_STAGING`, `KUBE_CONFIG_PRODUCTION` (base64 of each kubeconfig).
- Variables: `STAGING_API_BASE_URL`, `MOBILE_API_BASE_URL` (baked into admin/mobile builds).

**C3. ☁️ Let the cluster pull from GHCR.** If the images are private, create an image-pull secret in
the `cpe` namespace and attach it (or make the GHCR packages public). Also confirm `GITHUB_TOKEN`
has `packages: write` (the workflow already requests it).

**C4. 🚀 First deploy.** Merge to `main` → `deploy.yml` builds images, migrates + rolls out
**staging** automatically, then waits at the **production** gate. Approve it to go live. Verify:
`curl https://api.example.com/api/v1/health/ready` (won't exist as a public path — use a real
endpoint) and load `https://admin.example.com`.

---

## D. Mobile: signing, stores, and the build pipeline

**D1. 📱 Google Play.** Create the app in the Play Console (package
`com.circularpaper.cpe_mobile`), enable Play App Signing, create a **service account** with Play
Console access and download its JSON, and create an **internal testing** track.

**D2. 📱 App Store Connect.** Register the bundle id `com.circularpaper.cpeMobile`, create the app,
create an **App Store Connect API key** (Keys → download the `.p8`), and set up TestFlight internal
testers.

**D3. 🧑‍💻🔑 Android release signing** (one-time):

- Generate an upload keystore (`keytool -genkey -v -keystore upload-keystore.jks ...`).
- Wire release signing in `apps/mobile/android/app/build.gradle.kts` to read `key.properties` (the
  standard Flutter release-signing block).
- Secrets: `ANDROID_KEYSTORE_BASE64` (base64 of the .jks), `ANDROID_KEY_PROPERTIES` (the
  key.properties contents), `PLAY_STORE_SERVICE_ACCOUNT_JSON`.

**D4. 🧑‍💻🔑 iOS signing** (one-time):

- Create a distribution certificate (.p12) and an App Store provisioning profile for the bundle id.
- Add `apps/mobile/ios/ExportOptions.plist` (method `app-store`, your team id).
- Secrets: `IOS_DIST_CERT_P12_BASE64`, `IOS_DIST_CERT_PASSWORD`, `IOS_PROVISIONING_PROFILE_BASE64`,
  `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_CONTENT` (base64 of the .p8), plus the `Appfile` env
  (`APPLE_ID`, `ASC_TEAM_ID`, `DEVELOPER_TEAM_ID`). Also `MOBILE_SENTRY_DSN`.

**D5. 🚀 Build & promote.** Tag `mobile-v1.0.0` → `mobile-release.yml` builds a signed AAB + IPA,
then waits at `play-internal` / `appstore-internal`. Approve → it lands on the Play internal track /
TestFlight. Install on a test device via the internal track / TestFlight and smoke-test.

---

## E. Go-live

**E1. ✅ End-to-end smoke test** against production (internal build): OTP login → subscribe →
schedule a pickup → partner completes it → wallet credited → withdrawal request. Watch logs (by
`correlationId`), `/metrics`, and Sentry.

**E2. ☁️ Run the k6 load tests** (`apps/api/load/`) against staging to set real HPA thresholds, then
adjust `hpa.yaml`.

**E3. ⚖️ Clear the legal blockers before real money moves** (these are NOT engineering tasks and can
each independently block a public launch):

- **RBI / PPI:** the wallet holds real customer money but is not a licensed prepaid instrument.
  Decide: partner with a licensed PPI issuer, or restrict cash-out. (See the README regulatory note.)
- **DPDP** (India data protection) and **gig-worker classification** for delivery partners.

**E4. 📱 Promote to production on the stores.** From the Play Console, promote the internal build to
**production** (or a closed/open test track first); from App Store Connect, submit the TestFlight
build for **App Store review**. Store review typically takes 1–7 days. Once approved, the app is
publicly installable.

---

## The critical path, in one line

**A0 (SMS + storage providers)** → secrets + cluster (B) → first backend deploy (C) → mobile signing

- stores (D) → **E3 (RBI/PPI legal sign-off)** → promote to store production (E4). The two starred
  steps gate everything; start them on day one.
