import 'dart:convert';

import 'package:riverpod_annotation/riverpod_annotation.dart';

import 'app_database.dart';

part 'local_cache.g.dart';

/// The offline cache, and the policy for what may live in it.
///
/// The rule is per-DOMAIN, not blanket, because "cache everything" and "cache nothing" are
/// both wrong for this app:
///
///   - ALWAYS LIVE (never cached): the wallet balance. A stale balance is worse than a
///     spinner — a customer who sees ₹500 that is really ₹0 files a complaint, and a
///     partner who trusts a cached figure hands over cash against money that is not there.
///   - OFFLINE-FIRST (cached with a TTL): delivery history, pickup history, the newspaper
///     catalogue, and the signed-in profile. A delivery partner works a whole route with no
///     signal; showing them yesterday's list beats showing them nothing.
///
/// TTL semantics: a null TTL means "keep until explicitly replaced" (the profile); a
/// duration means a row past `expiresAt` is treated as absent and must be refetched.
enum CachePolicy {
  /// Read-through cache with the given freshness window.
  offlineFirst,

  /// Never cached — the caller must hit the network every time.
  alwaysLive,
}

/// Well-known cache keys, so a typo cannot silently split one logical entry into two.
abstract final class CacheKeys {
  static const authProfile = 'auth.profile';
  static const deliveryHistory = 'delivery.history';
  static const pickupHistory = 'pickup.history';
  static const newspaperCatalogue = 'catalogue.newspapers';
}

/// A tiny JSON+TTL wrapper over the Drift [CacheEntries] table. Feature repositories use
/// this instead of touching Drift directly, so caching behaves identically everywhere.
class LocalCache {
  LocalCache(this._db, {DateTime Function()? clock}) : _clock = clock ?? DateTime.now;

  final AppDatabase _db;
  final DateTime Function() _clock;

  Future<void> putJson(String key, Map<String, dynamic> value, {Duration? ttl}) {
    final now = _clock();
    return _db
        .into(_db.cacheEntries)
        .insertOnConflictUpdate(
          CacheEntry(
            key: key,
            value: jsonEncode(value),
            updatedAt: now,
            expiresAt: ttl == null ? null : now.add(ttl),
          ),
        );
  }

  /// Returns the cached JSON, or null if absent OR expired. An expired row is deleted on
  /// read so the cache does not grow unbounded with stale entries.
  Future<Map<String, dynamic>?> getJson(String key) async {
    final row = await (_db.select(
      _db.cacheEntries,
    )..where((t) => t.key.equals(key))).getSingleOrNull();
    if (row == null) return null;

    final expiresAt = row.expiresAt;
    if (expiresAt != null && _clock().isAfter(expiresAt)) {
      await delete(key);
      return null;
    }
    return jsonDecode(row.value) as Map<String, dynamic>;
  }

  Future<void> delete(String key) {
    return (_db.delete(_db.cacheEntries)..where((t) => t.key.equals(key))).go();
  }

  Future<void> clear() => _db.delete(_db.cacheEntries).go();
}

@Riverpod(keepAlive: true)
LocalCache localCache(Ref ref) => LocalCache(ref.watch(appDatabaseProvider));
