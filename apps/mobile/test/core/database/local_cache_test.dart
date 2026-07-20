import 'package:cpe_mobile/core/database/app_database.dart';
import 'package:cpe_mobile/core/database/local_cache.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late AppDatabase db;
  var now = DateTime.utc(2026, 1, 1, 12);

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
  });
  tearDown(() async => db.close());

  LocalCache cacheWithClock() => LocalCache(db, clock: () => now);

  test('stores and reads back JSON', () async {
    final cache = cacheWithClock();
    await cache.putJson('k', {'a': 1, 'b': 'two'});
    expect(await cache.getJson('k'), {'a': 1, 'b': 'two'});
  });

  test('an entry with no TTL never expires (the profile case)', () async {
    final cache = cacheWithClock();
    await cache.putJson(CacheKeys.authProfile, {'id': 'u1'});
    now = now.add(const Duration(days: 365));
    expect(await cache.getJson(CacheKeys.authProfile), {'id': 'u1'});
  });

  test('a TTL entry is returned while fresh and dropped once expired', () async {
    final cache = cacheWithClock();
    await cache.putJson('history', {'items': 3}, ttl: const Duration(hours: 1));

    now = now.add(const Duration(minutes: 30));
    expect(await cache.getJson('history'), {'items': 3}, reason: 'still fresh');

    now = now.add(const Duration(hours: 2));
    expect(await cache.getJson('history'), isNull, reason: 'past its TTL');
    // Reading an expired entry evicts it, so the row does not linger.
    final rows = await db.select(db.cacheEntries).get();
    expect(rows, isEmpty);
  });

  test('putJson upserts on the same key', () async {
    final cache = cacheWithClock();
    await cache.putJson('k', {'v': 1});
    await cache.putJson('k', {'v': 2});
    expect(await cache.getJson('k'), {'v': 2});
  });

  test('delete removes an entry', () async {
    final cache = cacheWithClock();
    await cache.putJson('k', {'v': 1});
    await cache.delete('k');
    expect(await cache.getJson('k'), isNull);
  });
}
