# Setup guide — getting the app live, in plain language

**You do not need to know TypeScript or write any code to follow this guide.** All the code is
already done. What's left is _account setup and configuration_ — signing up for services, copying
keys into boxes, and clicking "approve".

Think of it like opening a shop. The shop is built (that's the code). Now you need to rent the
building, get the electricity connected, put your name on the door, and get the licence to trade.

---

## What's already finished

|                                                                     | Status                                          |
| ------------------------------------------------------------------- | ----------------------------------------------- |
| The customer app (browse papers, subscribe, book pickups, wallet)   | ✅ Built                                        |
| The delivery-partner app (routes, scanning, weighing, offline mode) | ✅ Built                                        |
| The staff admin website                                             | ✅ Built                                        |
| The backend (all the logic, database, money handling)               | ✅ Built                                        |
| **Sending real OTP text messages**                                  | ✅ Built (just needs your MSG91 account keys)   |
| **Storing delivery photos properly**                                | ✅ Built (just needs your storage account keys) |
| Automatic deployment pipelines                                      | ✅ Built                                        |

**Nothing on that list needs code from you.** The last two used to be the blocker; they're done now.

---

## What's left — 5 jobs

| Job                                 | What it means in plain words                      | Roughly how long                        |
| ----------------------------------- | ------------------------------------------------- | --------------------------------------- |
| **1. Sign up for services**         | Create accounts, copy down the keys they give you | Half a day (+ waiting for SMS approval) |
| **2. Rent the server**              | Like buying web hosting, but for an app           | Half a day                              |
| **3. Connect GitHub to the server** | So the app installs itself onto the server        | 1–2 hours                               |
| **4. Get onto the app stores**      | Google/Apple developer accounts + paperwork       | A day (+ store review time)             |
| **5. Sort out the money licence**   | A legal question about holding customers' cash    | Weeks — start early                     |

**Start jobs 1 and 5 today.** Both involve waiting on other people (SMS template approval, legal
advice), so they're the long poles. The rest you control.

---

## JOB 1 — Sign up for services and collect your keys

You're collecting a list of passwords/keys. Keep them in a password manager (Bitwarden, 1Password) —
**not** in a text file in the project folder.

### 1a. MSG91 — for sending OTP text messages

This is the one with a waiting period, so do it first.

1. Sign up at **msg91.com**.
2. Complete **DLT registration**. This is an Indian government requirement (TRAI) — you can't send
   business SMS without it. They'll ask for:
   - Your **registered business name** — must match your GST/PAN paperwork exactly.
   - A **Sender ID** — the 6-letter name customers see as the sender. `ANVAYA` if that's your brand.
   - An **OTP message template** — the wording, e.g. `Your Anvaya verification code is {#var#}`.
3. **This approval can take a few days.** Submit it and move on to other jobs while you wait.
4. Once approved, collect three things:
   - `MSG91_AUTH_KEY` — dashboard → API → Auth Key
   - `MSG91_SENDER_ID` — your 6-letter sender (e.g. `ANVAYA`)
   - `MSG91_DLT_TEMPLATE_ID` — the "Flow ID" for your OTP template

> ⚠️ You need a **registered business** (GST/PAN) for DLT. If you don't have one yet, that's the real
> first step — nothing SMS-related can proceed without it.

### 1b. Cloudflare R2 — for storing delivery photos

Cheap and simple (no charge for downloads, unlike Amazon).

1. Sign up at **cloudflare.com** → find **R2** in the sidebar.
2. **Create a bucket** — name it something like `cpe-delivery-photos`. Keep it **private**.
3. **R2 → Manage API Tokens → Create API Token** → give it read/write on that bucket.
4. Collect four things:
   - `S3_ENDPOINT` — looks like `https://<your-account-id>.r2.cloudflarestorage.com`
   - `S3_BUCKET` — the bucket name you chose
   - `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` — shown once when you create the token, **copy
     them now**

### 1c. Razorpay — for taking card/UPI payments

1. Sign up at **razorpay.com**, complete their KYC (business documents).
2. **Settings → API Keys → Generate** → collect `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
3. **Settings → Webhooks → Add New Webhook**:
   - URL: `https://api.yourdomain.com/api/v1/marketplace/webhook` (you'll have this domain after
     Job 2 — you can come back and add it)
   - Copy the **webhook secret** it shows → that's `PAYMENT_WEBHOOK_SECRET`

### 1d. Firebase — for push notifications

1. **console.firebase.google.com** → create a project.
2. **Project settings → Service accounts → Generate new private key** → downloads a `.json` file.
3. That whole file's contents is `FCM_SERVICE_ACCOUNT_JSON`. Keep the file safe.

### 1e. A domain name

Buy one (GoDaddy, Namecheap, Cloudflare) — e.g. `anvaya.in`. You'll point these at your server later:

- `api.anvaya.in` (the backend)
- `admin.anvaya.in` (the staff website)

### 1f. Sentry — for crash reports (optional but recommended)

**sentry.io** → free tier → create **3 projects**: one Node.js (backend), one Next.js (admin), one
Flutter (mobile). Each gives you a **DSN** (a URL). Collect all three.

**✅ End of Job 1: you should have a list of ~14 keys saved in your password manager.**

---

## JOB 2 — Rent the server

I'd recommend **DigitalOcean** — cheapest and simplest for a pilot. Budget roughly **$60–100/month**
to start.

You'll need to install three command-line tools first. Tell me when you're at this step and I'll
walk you through installing them on your machine and run the setup commands with you — this is the
part where having me drive is genuinely faster than following written steps.

What we'll create together:

1. A **Kubernetes cluster** — the "building" your app runs in (~$36/mo for 3 small machines).
2. A **managed PostgreSQL database** — where all the data lives, with automatic backups (~$15/mo).
3. A **managed Redis** — a fast temporary store for queues and rate limits (~$15/mo).
4. **Ingress + TLS** — so `https://api.anvaya.in` works with a padlock, free certificates
   auto-renewing.
5. **DNS records** — pointing your domain at the server.
6. **The secrets** — loading all those Job 1 keys into the server securely.

> **Cheaper alternative:** if $60–100/mo is too much for a pilot, we can deploy to a single
> DigitalOcean droplet (~$12/mo) with Docker instead of Kubernetes. Less scalable, much cheaper,
> and the app code doesn't change. Say the word and I'll set that path up instead.

---

## JOB 3 — Connect GitHub to the server

This makes it so pushing code automatically installs it on the server — no manual deploying.

Three parts, all clicking in GitHub's settings (I'll give you exact click-paths when you're here):

1. **Create 4 "Environments"** — `staging`, `production`, `play-internal`, `appstore-internal`. On
   the last three, turn on "Required reviewers" and add yourself. This is what makes deploys _wait
   for you to click approve_ instead of going live automatically.
2. **Add secrets** — paste the server access file and a couple of URLs into GitHub's secret storage.
3. **First deploy** — push to `main`, watch it build, click approve. Done.

---

## JOB 4 — Get onto the app stores

### Google Play (₹2,000 one-time)

1. Sign up at **play.google.com/console**.
2. Create the app. Package name: `com.circularpaper.cpe_mobile`.
3. Create an **"Internal testing"** track and add your own email as a tester.
4. Create a **service account** (so the pipeline can upload builds for you) — I'll walk you through
   this, it's the fiddliest part of Job 4.
5. Fill in the **store listing**: app name, description, screenshots, a privacy policy URL, and
   Google's Data Safety questionnaire. **This is the part that takes real time** — budget a day for
   writing copy and taking screenshots.

### Apple App Store ($99/year)

1. Enroll at **developer.apple.com** (needs a D-U-N-S number for a company account — can take days).
2. **App Store Connect** → create the app. Bundle ID: `com.circularpaper.cpeMobile`.
3. Create an **API key** so the pipeline can upload.
4. Same store listing work: description, screenshots, privacy details.

> ⚠️ **You need a Mac for iOS**, at least for the initial certificate setup. No Mac? Ship Android
> first — it's the bigger market in India anyway, and iOS can follow.

### Signing (the "seal" that proves builds are really from you)

There's a one-time setup: generate a keystore for Android, certificates for iOS, and load them into
GitHub. It's mechanical but easy to get wrong — **ask me and I'll do this with you step by step**.

Then: pushing a tag like `mobile-v1.0.0` builds both apps, waits for your approval, and uploads them
to internal testing / TestFlight where you can install them on your own phone.

---

## JOB 5 — The money licence (start this now)

**This is the one thing that can stop the whole launch, and it isn't a technical problem.**

The app has a wallet. Customers earn cashback into it and can withdraw it. Under RBI rules, holding
customers' money like that can require a **Prepaid Payment Instrument (PPI) licence**, which is
expensive and slow to obtain.

**Talk to a fintech lawyer or a CA who knows RBI rules.** Your realistic options:

| Option                             | What it means                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Partner with a licensed issuer** | A licensed company holds the money; you use their rails. Most common path.                      |
| **Pay out directly, don't hold**   | Money goes straight to their bank/UPI instead of sitting in a wallet. Often avoids the licence. |
| **Vouchers only**                  | Cashback can only be spent in your marketplace, never withdrawn as cash. Simplest legally.      |

Also ask about: **DPDP** (India's data protection law — you handle names, phones, addresses) and
**gig-worker classification** for your delivery partners.

> Until this is settled, you can safely pilot with a **small closed group** where cashback is
> vouchers-only. That's a real product test with no licensing exposure.

---

## So, what do I do right now?

**This week:**

1. ☐ Confirm you have a registered business (GST/PAN). If not, that's step zero.
2. ☐ Start MSG91 signup + DLT registration (the multi-day wait).
3. ☐ Email 2–3 fintech lawyers/CAs about the wallet question (Job 5).
4. ☐ Buy your domain name.

**Then come back and tell me which one you want to tackle**, and I'll walk you through that one job
step by step — commands typed out, or I'll run them for you where I can. Don't try to do all five at
once, and don't read the whole of this guide as a to-do list for today.

**Genuinely useful thing to know:** the technical setup (Jobs 2 and 3) is maybe a day of work with me
driving. The slow parts are all _other people_ — DLT approval, legal advice, store review. So the
sooner those are in motion, the sooner you launch.
