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
  const AppConfig({required this.apiBaseUrl, required this.environment});

  factory AppConfig.fromEnvironment() {
    return const AppConfig(
      apiBaseUrl: String.fromEnvironment(
        'API_BASE_URL',
        defaultValue: 'http://10.0.2.2:3000/api/v1',
      ),
      environment: String.fromEnvironment('APP_ENV', defaultValue: 'development'),
    );
  }

  final String apiBaseUrl;
  final String environment;

  bool get isProduction => environment == 'production';
}
