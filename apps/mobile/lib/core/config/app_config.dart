/// Build-time configuration.
///
/// Values come from `--dart-define` (or `--dart-define-from-file`), never from a
/// bundled .env file: anything shipped inside the app bundle is readable by anyone
/// who unzips the APK. Only non-secret values belong here — a mobile app cannot
/// keep a secret, so API keys that matter stay server-side.
///
///   flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
///
/// 10.0.2.2 is how the Android emulator reaches the host's localhost.
class AppConfig {
  const AppConfig({required this.apiBaseUrl, required this.environment, required this.sentryDsn});

  factory AppConfig.fromEnvironment() {
    return const AppConfig(
      apiBaseUrl: String.fromEnvironment(
        'API_BASE_URL',
        defaultValue: 'http://10.0.2.2:3000/api/v1',
      ),
      environment: String.fromEnvironment('APP_ENV', defaultValue: 'development'),
      // A Sentry DSN is an ingest key, safe to ship (it can only write events). Empty by default
      // so dev/test builds report nothing; the release build passes it via --dart-define.
      sentryDsn: String.fromEnvironment('SENTRY_DSN'),
    );
  }

  final String apiBaseUrl;
  final String environment;

  /// Empty when crash reporting is disabled (dev, tests, and any build without the define).
  final String sentryDsn;

  bool get isProduction => environment == 'production';

  bool get crashReportingEnabled => sentryDsn.isNotEmpty;
}
