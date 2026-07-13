import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

part 'app_database.g.dart';

/// Generic offline cache. Feature-specific tables arrive with the features that
/// need them (Phase 11 onwards); this exists so the Drift toolchain is wired and
/// proven before anything depends on it.
///
/// What gets cached is a per-feature decision, not a blanket one:
///   - cache: delivery history, pickup history, the newspaper catalogue
///   - never cache: wallet balance — a stale balance is worse than a spinner
@DataClassName('CacheEntry')
class CacheEntries extends Table {
  TextColumn get key => text()();
  TextColumn get value => text()();
  DateTimeColumn get updatedAt => dateTime()();

  /// Written on read; a row past this instant must be refetched, not shown.
  DateTimeColumn get expiresAt => dateTime().nullable()();

  @override
  Set<Column> get primaryKey => {key};
}

@DriftDatabase(tables: [CacheEntries])
class AppDatabase extends _$AppDatabase {
  AppDatabase([QueryExecutor? executor]) : super(executor ?? _open());

  /// In-memory database for tests — no file I/O, no cross-test contamination.
  AppDatabase.forTesting(super.executor);

  @override
  int get schemaVersion => 1;

  static QueryExecutor _open() => driftDatabase(name: 'cpe_local');
}

@Riverpod(keepAlive: true)
AppDatabase appDatabase(Ref ref) {
  final db = AppDatabase();
  ref.onDispose(db.close);
  return db;
}
