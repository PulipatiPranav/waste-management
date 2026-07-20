import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

part 'token_store.g.dart';

/// Where the access and refresh tokens live.
///
/// An interface, not a concrete class, for one reason that matters: the refresh token is
/// the long-lived credential, and it goes in the OS keystore (`flutter_secure_storage`),
/// NEVER in `SharedPreferences` — SharedPreferences is a plaintext XML/plist file any
/// backup or rooted device can read. The interface also lets tests use an in-memory fake,
/// because `flutter_secure_storage` talks to a platform channel that does not exist under
/// `flutter test`.
abstract interface class TokenStore {
  Future<String?> readAccessToken();
  Future<String?> readRefreshToken();
  Future<void> saveTokens({required String accessToken, required String refreshToken});
  Future<void> clear();
}

class SecureTokenStore implements TokenStore {
  SecureTokenStore(this._storage);

  final FlutterSecureStorage _storage;

  static const _accessKey = 'cpe.accessToken';
  static const _refreshKey = 'cpe.refreshToken';

  @override
  Future<String?> readAccessToken() => _storage.read(key: _accessKey);

  @override
  Future<String?> readRefreshToken() => _storage.read(key: _refreshKey);

  @override
  Future<void> saveTokens({required String accessToken, required String refreshToken}) async {
    // Two writes, not one JSON blob: the access token is read on every request and the
    // refresh token only on a 401, so keeping them separate avoids deserialising the
    // sensitive one on the hot path.
    await _storage.write(key: _accessKey, value: accessToken);
    await _storage.write(key: _refreshKey, value: refreshToken);
  }

  @override
  Future<void> clear() async {
    await _storage.delete(key: _accessKey);
    await _storage.delete(key: _refreshKey);
  }
}

@Riverpod(keepAlive: true)
TokenStore tokenStore(Ref ref) {
  // Backed by the Android Keystore (via custom ciphers) and the iOS Keychain. Defaults are
  // the secure ones; the old encryptedSharedPreferences flag is deprecated and unnecessary.
  return SecureTokenStore(const FlutterSecureStorage());
}
