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

/// The OFFLINE ACTION QUEUE — the most safety-critical table in the app.
///
/// A delivery partner works a whole route with no signal. Marking a stop delivered or completing a
/// pickup must NEVER be lost because the network was down at that instant. So the action is written
/// HERE first, durably, and synced later — this row is the source of truth until the server
/// acknowledges it.
///
/// `dedupeKey` (kind + target id) is unique: re-recording the same stop before it syncs REPLACES
/// the pending row rather than queuing a second one, so a partner tapping twice, or correcting an
/// outcome, produces exactly one action — the latest — not two conflicting sends.
@DataClassName('PendingAction')
class PendingActions extends Table {
  IntColumn get id => integer().autoIncrement()();

  /// A stable identity for de-duplication: `kind:targetId`.
  TextColumn get dedupeKey => text().unique()();

  /// 'delivery_outcome' | 'pickup_complete'.
  TextColumn get kind => text()();

  /// The stop id or pickup id this action applies to.
  TextColumn get targetId => text()();

  /// The request body, JSON-encoded.
  TextColumn get payload => text()();

  /// 'pending' (awaiting sync), 'failed' (a permanent error the partner must see). A synced action
  /// is DELETED, not kept — the server is then the record.
  TextColumn get status => text().withDefault(const Constant('pending'))();

  IntColumn get attempts => integer().withDefault(const Constant(0))();
  TextColumn get lastError => text().nullable()();

  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get updatedAt => dateTime()();
}

@DriftDatabase(tables: [CacheEntries, PendingActions])
class AppDatabase extends _$AppDatabase {
  AppDatabase([QueryExecutor? executor]) : super(executor ?? _open());

  /// In-memory database for tests — no file I/O, no cross-test contamination.
  AppDatabase.forTesting(super.executor);

  @override
  int get schemaVersion => 2;

  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (m) => m.createAll(),
    onUpgrade: (m, from, to) async {
      // v1 -> v2 adds the offline action queue. Additive only — no existing cache is touched.
      if (from < 2) await m.createTable(pendingActions);
    },
  );

  static QueryExecutor _open() => driftDatabase(name: 'cpe_local');
}

@Riverpod(keepAlive: true)
AppDatabase appDatabase(Ref ref) {
  final db = AppDatabase();
  ref.onDispose(db.close);
  return db;
}
