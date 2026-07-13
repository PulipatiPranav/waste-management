import 'package:cpe_mobile/core/database/app_database.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';

/// Proves the Drift toolchain is wired: schema compiles, codegen ran, queries work.
/// The in-memory executor keeps it hermetic — no file I/O, no shared state.
void main() {
  late AppDatabase db;

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
  });

  tearDown(() async {
    await db.close();
  });

  test('writes and reads back a cache entry', () async {
    final now = DateTime.now();

    await db
        .into(db.cacheEntries)
        .insert(CacheEntriesCompanion.insert(key: 'k', value: 'v', updatedAt: now));

    final rows = await db.select(db.cacheEntries).get();

    expect(rows, hasLength(1));
    expect(rows.single.key, 'k');
    expect(rows.single.value, 'v');
  });

  test('upserts on a duplicate key rather than throwing', () async {
    final now = DateTime.now();
    final entry = CacheEntriesCompanion.insert(key: 'k', value: 'first', updatedAt: now);

    await db.into(db.cacheEntries).insert(entry);
    await db
        .into(db.cacheEntries)
        .insertOnConflictUpdate(
          CacheEntriesCompanion.insert(key: 'k', value: 'second', updatedAt: now),
        );

    final rows = await db.select(db.cacheEntries).get();

    expect(rows, hasLength(1));
    expect(rows.single.value, 'second');
  });
}
