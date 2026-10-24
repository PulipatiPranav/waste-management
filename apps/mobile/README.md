# Circular Paper Economy — mobile app

One Flutter app for both **customers** and **delivery partners**; the router sends each role to
its own shell after OTP sign-in.

- **Customer:** browse newspapers by pincode and subscribe; book a paper pickup and show its QR
  code at the door; wallet balance, ledger and withdrawals; personal recycling impact; marketplace.
- **Delivery partner:** today's route with delivered / failed / skipped outcomes and photo proof;
  QR scan and per-paper-type weighing; run history. Every field action goes to a durable offline
  queue first and syncs when signal returns.

## Stack

Riverpod (state), GoRouter (navigation and the single auth/role guard), Dio (HTTP with a
single-flight token-refresh interceptor), Drift/SQLite (offline cache and sync queue),
freezed/json_serializable (models), `flutter_secure_storage` (tokens in the OS keystore).

```
lib/
  core/            config, router, network, database, theme, shared widgets
  features/<name>/
    data/          DTOs + repository implementations (the only layer that knows Dio)
    domain/        entities + repository interfaces (pure Dart)
    presentation/  screens + Riverpod controllers
```

## Run

Generated files (`*.g.dart`, `*.freezed.dart`) are not committed, so generate them first:

```bash
flutter pub get
dart run build_runner build
flutter analyze
flutter test

# Against the hosted demo API (any phone number, OTP 000000):
flutter run --dart-define=API_BASE_URL=https://circular-paper-api.onrender.com/api/v1

# Against a local API from the Android emulator:
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
```

Release builds are produced by `.github/workflows/mobile-release.yml` on a `mobile-v*` tag. See
the [engineering notes](../../docs/engineering-notes.md#mobile-app-foundation-phase-11) for the
design decisions.
