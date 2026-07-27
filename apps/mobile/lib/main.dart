import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

import 'core/config/app_config.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';

/// App entry point. When a Sentry DSN is configured (release builds, via `--dart-define=SENTRY_DSN`),
/// crash reporting wraps the whole app so an uncaught Dart or Flutter error becomes a report with a
/// stack trace rather than a silent white screen a support ticket can never reproduce. Without a DSN
/// — dev and every test build — it is a plain `runApp`, so nothing is sent and startup is unchanged.
Future<void> main() async {
  final config = AppConfig.fromEnvironment();

  if (!config.crashReportingEnabled) {
    runApp(const ProviderScope(child: CpeApp()));
    return;
  }

  await SentryFlutter.init(
    (options) {
      options.dsn = config.sentryDsn;
      options.environment = config.environment;
      // Traces off by default; turn up deliberately, it is not free on a phone.
      options.tracesSampleRate = 0;
      // This app shows customer PII (phones, addresses, wallet balances). Never attach a screenshot,
      // and never send default PII, or a crash report leaks a customer's data. (View-hierarchy
      // attachment is off by default and left at its default.)
      options.attachScreenshot = false;
      options.sendDefaultPii = false;
    },
    // SentryFlutter.init installs the zone/error handlers and runs the app inside them.
    appRunner: () => runApp(const ProviderScope(child: CpeApp())),
  );
}

class CpeApp extends ConsumerWidget {
  const CpeApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);

    return MaterialApp.router(
      title: 'Circular Paper Economy',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: ThemeMode.system,
      routerConfig: router,
    );
  }
}
