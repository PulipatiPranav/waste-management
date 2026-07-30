# Setup guide — executing the go-live roadmap

Concrete, copy-pasteable steps for each item in [`go-live-roadmap.md`](go-live-roadmap.md). Where a
choice matters, this guide takes the **simplest path for a solo/pilot launch** — DigitalOcean
(managed k8s + Postgres + Redis), MSG91 (SMS), Cloudflare R2 (storage) — and notes the AWS/GCP
equivalents. Swap freely; the shapes are the same.

> Do the steps in order. A0 (code) and E3 (legal) are the long poles — start them on day one.

---

## A0 — Implement the SMS + storage providers (the one code blocker)

The API refuses to boot in `NODE_ENV=production` on the dev stubs. Both are small, isolated adapters
behind an existing interface — no use-case code changes.

### A0.1 SMS (MSG91)

The port is `apps/api/src/modules/auth/domain/ports/sms-provider.port.ts`
(`SmsProvider.send({ to, body, templateId? })`). The console stub lives beside it.

1. **Add the provider to the enum** in `apps/api/src/config/env.schema.ts`:

   ```ts
   SMS_PROVIDER: z.enum(['console', 'msg91']).default('console'),
   // add the credentials:
   MSG91_AUTH_KEY: z.string().optional(),
   MSG91_SENDER_ID: z.string().optional(),
   MSG91_DLT_TEMPLATE_ID: z.string().optional(),
   ```

   And in the `superRefine`, require them when selected:

   ```ts
   if (env.SMS_PROVIDER === "msg91" && !env.MSG91_AUTH_KEY) {
     ctx.addIssue({
       code: "custom",
       path: ["MSG91_AUTH_KEY"],
       message: "MSG91_AUTH_KEY is required when SMS_PROVIDER=msg91.",
     });
   }
   ```

2. **Create the adapter** `apps/api/src/modules/auth/infrastructure/sms/msg91-sms.provider.ts`:

   ```ts
   import { Injectable } from "@nestjs/common";
   import { ConfigService } from "@nestjs/config";
   import { type Env } from "@/config/env.schema";
   import { type SendSmsCommand, type SmsProvider } from "../../domain/ports/sms-provider.port";

   @Injectable()
   export class Msg91SmsProvider implements SmsProvider {
     constructor(private readonly config: ConfigService<Env, true>) {}

     async send(command: SendSmsCommand): Promise<void> {
       // NEVER log command.body — it holds the OTP.
       const res = await fetch("https://control.msg91.com/api/v5/flow/", {
         method: "POST",
         headers: {
           "Content-Type": "application/json",
           authkey: this.config.get("MSG91_AUTH_KEY", { infer: true })!,
         },
         body: JSON.stringify({
           template_id:
             command.templateId ?? this.config.get("MSG91_DLT_TEMPLATE_ID", { infer: true }),
           sender: this.config.get("MSG91_SENDER_ID", { infer: true }),
           recipients: [{ mobiles: command.to.replace("+", ""), OTP: command.body }],
         }),
       });
       if (!res.ok) throw new Error(`MSG91 send failed: ${res.status}`);
     }
   }
   ```

   (Exact payload depends on how you build your MSG91 **Flow/template** — OTP vs a `##var##` in the
   template. Match the variable names to your registered DLT template.)

3. **Wire it by config** in `apps/api/src/modules/auth/auth.module.ts` — replace the hardcoded
   `{ provide: SMS_PROVIDER, useClass: ConsoleSmsProvider }` with a factory:
   ```ts
   {
     provide: SMS_PROVIDER,
     inject: [ConfigService, /* the deps each provider needs */],
     useFactory: (config: ConfigService<Env, true>) =>
       config.get('SMS_PROVIDER', { infer: true }) === 'msg91'
         ? new Msg91SmsProvider(config)
         : new ConsoleSmsProvider(),
   },
   ```

### A0.2 Storage (Cloudflare R2 — S3-compatible)

The port is `apps/api/src/modules/delivery/domain/ports/storage-provider.port.ts`
(`put`, `getSignedUrl`, `delete`). Add the AWS S3 SDK (R2 speaks the S3 API):

```bash
pnpm --filter @cpe/api add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

1. **Enum + creds** in `env.schema.ts`:

   ```ts
   STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
   S3_ENDPOINT: z.string().url().optional(),      // R2: https://<acct>.r2.cloudflarestorage.com
   S3_REGION: z.string().default('auto'),
   S3_BUCKET: z.string().optional(),
   S3_ACCESS_KEY_ID: z.string().optional(),
   S3_SECRET_ACCESS_KEY: z.string().optional(),
   ```

   Require them in `superRefine` when `STORAGE_PROVIDER === 's3'`.

2. **Adapter** `apps/api/src/modules/delivery/infrastructure/storage/s3-storage.provider.ts`
   implementing `put` (`PutObjectCommand`), `getSignedUrl` (`getSignedUrl(client, GetObjectCommand,
{ expiresIn })`), `delete` (`DeleteObjectCommand`) with an `S3Client({ endpoint, region,
credentials, forcePathStyle: true })`.

3. **Wire by config** in `delivery.module.ts`, same `useFactory` pattern as the SMS provider.

**Verify:** `pnpm --filter @cpe/api lint && pnpm --filter @cpe/api typecheck && pnpm --filter @cpe/api test`.
Add a unit test for each adapter's URL/signature building.

> Want me to implement A0 for you? Tell me the two providers (e.g. MSG91 + R2) and I'll write the
> adapters, enum/superRefine changes, wiring, tests, and env docs, then run the gate.

### A0.3 Get the credentials

- **MSG91:** sign up → complete DLT registration (sender ID + OTP template — mandatory in India, can
  take a few days) → copy the **Auth Key**.
- **Cloudflare R2:** create a bucket → **R2 → Manage API Tokens → Create** → note the endpoint,
  access key id, secret.
- **Razorpay:** dashboard → **Settings → API Keys** (key id + secret) and **Webhooks** (create a
  webhook to `https://api.<you>/api/v1/marketplace/webhook` → copy the signing secret).
- **FCM:** Firebase console → Project settings → **Service accounts → Generate new private key**
  (the whole JSON is `FCM_SERVICE_ACCOUNT_JSON`).

---

## A1 / B — Backend infrastructure (DigitalOcean path)

Install the CLIs once: `doctl` (DigitalOcean), `kubectl`, `helm`.

### B1. Cluster + ingress + TLS

```bash
doctl auth init
# 1) Managed k8s cluster (3 small nodes is plenty for a pilot):
doctl kubernetes cluster create cpe --region blr1 --node-pool "name=pool;size=s-2vcpu-4gb;count=3"
doctl kubernetes cluster kubeconfig save cpe        # points kubectl at it

# 2) Ingress controller:
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx && helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx -n ingress-nginx --create-namespace

# 3) cert-manager for automatic Let's Encrypt TLS:
helm repo add jetstack https://charts.jetstack.io && helm repo update
helm install cert-manager jetstack/cert-manager -n cert-manager --create-namespace \
  --set crds.enabled=true
```

Create the `letsencrypt-prod` ClusterIssuer the Ingress annotations expect (save as `issuer.yaml`,
`kubectl apply -f issuer.yaml`):

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: you@yourdomain.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: nginx
```

### B2. Managed Postgres + Redis

```bash
doctl databases create cpe-pg    --engine pg    --region blr1 --size db-s-1vcpu-1gb
doctl databases create cpe-redis --engine redis --region blr1 --size db-s-1vcpu-1gb
```

From the DO dashboard copy the **Postgres connection string** (→ `DATABASE_URL`, add
`?schema=public&sslmode=require`) and the **Redis host/port/password**. Add the cluster to each DB's
**trusted sources**. (AWS: RDS + ElastiCache. GCP: Cloud SQL + Memorystore.)

Since you're using managed Redis, drop the in-cluster one: remove `redis.yaml` from
`infra/k8s/base/kustomization.yaml` and set `REDIS_HOST`/`REDIS_PORT` in `api-config.yaml` to the
managed endpoint.

### B3. DNS

Point these A records at the ingress LB IP (`kubectl -n ingress-nginx get svc ingress-nginx-controller`
→ EXTERNAL-IP):

```
api.yourdomain.com          → <LB IP>
admin.yourdomain.com        → <LB IP>
api.staging.yourdomain.com  → <LB IP>
admin.staging.yourdomain.com→ <LB IP>
```

### B4. Point the manifests at your domain

Edit `infra/k8s/base/api-config.yaml` (`CORS_ORIGINS`), and the `example.com` hostnames in
`infra/k8s/overlays/staging/kustomization.yaml` and `overlays/production/kustomization.yaml` (the
Ingress host patches). Also set the collector endpoint if you deploy one (B6).

### B5. Create the secrets

For a pilot, create the k8s Secret imperatively (upgrade to External Secrets Operator later):

```bash
kubectl create namespace cpe
kubectl create secret generic cpe-api-secrets -n cpe \
  --from-literal=DATABASE_URL='postgresql://...:...@...:25060/cpe?schema=public&sslmode=require' \
  --from-literal=REDIS_PASSWORD='<managed redis password>' \
  --from-literal=JWT_ACCESS_SECRET="$(openssl rand -base64 48)" \
  --from-literal=PAYMENT_WEBHOOK_SECRET='<razorpay webhook secret>' \
  --from-literal=RAZORPAY_KEY_ID='...' \
  --from-literal=RAZORPAY_KEY_SECRET='...' \
  --from-literal=MSG91_AUTH_KEY='...' \
  --from-literal=S3_ACCESS_KEY_ID='...' \
  --from-literal=S3_SECRET_ACCESS_KEY='...' \
  --from-literal=FCM_SERVICE_ACCOUNT_JSON="$(cat firebase-service-account.json)"
```

Put the non-secret provider selectors (`SMS_PROVIDER=msg91`, `STORAGE_PROVIDER=s3`, `S3_ENDPOINT`,
`S3_BUCKET`, `PAYMENT_GATEWAY_PROVIDER=razorpay`, `PUSH_PROVIDER=fcm`, `MSG91_SENDER_ID`,
`MSG91_DLT_TEMPLATE_ID`) into `api-config.yaml`.

### B6. (Optional) Observability

- `helm install` kube-prometheus-stack (Prometheus + Grafana) and add a scrape for the `cpe-api`
  Service `/metrics`.
- Deploy an OpenTelemetry Collector; set `OTEL_EXPORTER_OTLP_ENDPOINT` in `api-config.yaml`.
- Create 3 Sentry projects; put the DSNs in the Secret / config. Production already has
  `OTEL_ENABLED=true`.

---

## C — CI/CD

### C1. GitHub Environments (repo → **Settings → Environments → New environment**)

Create four: `staging` (no protection), `production`, `play-internal`, `appstore-internal`. On the
last three, tick **Required reviewers** and add yourself — that IS the manual approval gate.

### C2. Repo secrets & variables (**Settings → Secrets and variables → Actions**)

```bash
# Cluster access (one kubeconfig per env; for a single cluster, use the same file):
doctl kubernetes cluster kubeconfig show cpe | base64 -w0 | gh secret set KUBE_CONFIG_STAGING
doctl kubernetes cluster kubeconfig show cpe | base64 -w0 | gh secret set KUBE_CONFIG_PRODUCTION
# Build-time public URLs (Variables, not Secrets):
gh variable set STAGING_API_BASE_URL --body "https://api.staging.yourdomain.com/api/v1"
gh variable set MOBILE_API_BASE_URL  --body "https://api.yourdomain.com/api/v1"
```

### C3. Let the cluster pull images from GHCR

Simplest: after the first `deploy.yml` run pushes images, make the GHCR packages **public** (GitHub →
your profile → Packages → each package → Package settings → Change visibility). Otherwise create an
image-pull secret in `cpe` and add `imagePullSecrets` to the Deployments.

### C4. First deploy

Merge any commit to `main` (or run **Actions → Deploy → Run workflow**). It builds images →
auto-deploys **staging** → pauses at **production**. Approve production in the Actions UI. Verify:

```bash
kubectl -n cpe get pods                        # all Running/Ready
kubectl -n cpe logs deploy/cpe-api | tail       # JSON logs, no boot errors
curl https://admin.yourdomain.com               # admin loads
```

---

## D — Mobile: signing + stores

### D1. Google Play (one-time, ~$25)

Play Console → **Create app** → later, **Setup → App integrity** keep Play App Signing on. Create a
**service account**: Google Cloud console → IAM → Service Accounts → create → grant it access in
Play Console (**Users & permissions → Invite → this service account → Admin (or release) on the app**)
→ create a **JSON key** (this is `PLAY_STORE_SERVICE_ACCOUNT_JSON`). Create the **Internal testing**
track and add your tester email.

### D2. App Store Connect (one-time, $99/yr)

Enroll in the Apple Developer Program. App Store Connect → **Apps → +** → register the bundle id
`com.circularpaper.cpeMobile`. **Users and Access → Integrations → App Store Connect API → generate
key** (Admin/App Manager) → download the `.p8` (you get it once) and note the **Key ID** + **Issuer
ID**. Set up **TestFlight** internal testers.

### D3. Android signing

```bash
# 1) Generate the upload keystore (answer the prompts; remember the passwords):
keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 \
        -validity 10000 -alias upload
```

Add the release signing block to `apps/mobile/android/app/build.gradle.kts` (top of file + inside
`android {}`):

```kotlin
import java.util.Properties
import java.io.FileInputStream

val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) keystoreProperties.load(FileInputStream(keystorePropertiesFile))

android {
    signingConfigs {
        create("release") {
            keyAlias = keystoreProperties["keyAlias"] as String?
            keyPassword = keystoreProperties["keyPassword"] as String?
            storeFile = (keystoreProperties["storeFile"] as String?)?.let { file(it) }
            storePassword = keystoreProperties["storePassword"] as String?
        }
    }
    buildTypes {
        getByName("release") { signingConfig = signingConfigs.getByName("release") }
    }
}
```

`key.properties` (this is the content of the `ANDROID_KEY_PROPERTIES` secret; the CI writes it and
the keystore to disk before building — `storeFile` is resolved relative to `android/app/`):

```
storePassword=<store pw>
keyPassword=<key pw>
keyAlias=upload
storeFile=upload-keystore.jks
```

Set the CI secrets:

```bash
base64 -w0 upload-keystore.jks | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEY_PROPERTIES < key.properties
gh secret set PLAY_STORE_SERVICE_ACCOUNT_JSON < play-service-account.json
gh secret set MOBILE_SENTRY_DSN --body "<mobile sentry dsn>"
```

### D4. iOS signing

In the Apple Developer portal create a **Distribution certificate** (export as `.p12` with a
password) and an **App Store provisioning profile** for the bundle id (download the
`.mobileprovision`). Add `apps/mobile/ios/ExportOptions.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store</string>
  <key>teamID</key><string>YOURTEAMID</string>
  <key>signingStyle</key><string>manual</string>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
```

Secrets:

```bash
base64 -w0 dist-cert.p12                | gh secret set IOS_DIST_CERT_P12_BASE64
gh secret set IOS_DIST_CERT_PASSWORD    --body "<p12 password>"
base64 -w0 profile.mobileprovision      | gh secret set IOS_PROVISIONING_PROFILE_BASE64
gh secret set ASC_KEY_ID                --body "<key id>"
gh secret set ASC_ISSUER_ID             --body "<issuer id>"
base64 -w0 AuthKey_XXXX.p8              | gh secret set ASC_KEY_CONTENT
```

The Fastlane `Appfile`s also read `APPLE_ID`, `ASC_TEAM_ID`, `DEVELOPER_TEAM_ID` — set them as repo
variables or export them in the workflow.

### D5. Build & promote

```bash
git tag mobile-v1.0.0 && git push origin mobile-v1.0.0
```

`mobile-release.yml` builds the signed AAB + IPA, then pauses at `play-internal` /
`appstore-internal`. Approve each in the Actions UI → the AAB lands on the Play **internal** track,
the IPA on **TestFlight**. Install via the internal track / TestFlight on a real device.

---

## E — Go-live

1. **Smoke test** on the internal build against production: request OTP (you should receive a real
   SMS), log in, subscribe, schedule a pickup, complete it as a partner, confirm the wallet credit,
   request a withdrawal. Watch `kubectl logs`, Grafana, Sentry.
2. **Load test:** run `apps/api/load/` against staging (see that README), then set `hpa.yaml`
   thresholds from the numbers.
3. **Legal (do NOT skip before real money):** get a decision on **RBI/PPI** (the wallet isn't a
   licensed prepaid instrument — partner with a licensed issuer or restrict cash-out), **DPDP**, and
   **gig-worker classification**. These are not engineering tasks and each can block a public launch.
4. **Promote to production:** Play Console → promote the internal build to a closed/open test track,
   then Production. App Store Connect → submit the TestFlight build for App Store review (1–7 days).
   Once approved, the app is publicly installable.

---

## Fastest safe sequence

1. A0 code (SMS + storage) → merge. 2. Provision cluster + DBs + DNS + secrets (B). 3. First deploy,
   approve staging→prod (C). 4. Smoke-test the API. 5. Mobile signing + stores + tag a build (D).
2. Internal-track smoke test. 7. RBI/PPI sign-off (E3). 8. Promote on both stores (E4).
