import 'dart:typed_data';

import 'package:cpe_mobile/core/database/app_database.dart';
import 'package:cpe_mobile/core/network/dio_client.dart';
import 'package:cpe_mobile/core/storage/token_store.dart';
import 'package:cpe_mobile/features/auth/data/auth_repository_impl.dart';
import 'package:dio/dio.dart';
import 'package:cpe_mobile/features/auth/domain/auth_repository.dart';
import 'package:cpe_mobile/features/auth/domain/auth_user.dart';
import 'package:cpe_mobile/features/auth/domain/session.dart';
import 'package:cpe_mobile/features/auth/domain/user_role.dart';
import 'package:cpe_mobile/features/partner/sync/sync_queue.dart';
import 'package:cpe_mobile/features/partner/sync/syncer.dart';
import 'package:cpe_mobile/core/network/api_failure.dart';
import 'package:cpe_mobile/main.dart';
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeTokenStore implements TokenStore {
  String? _access;
  String? _refresh;
  @override
  Future<String?> readAccessToken() async => _access;
  @override
  Future<String?> readRefreshToken() async => _refresh;
  @override
  Future<void> saveTokens({required String accessToken, required String refreshToken}) async {
    _access = accessToken;
    _refresh = refreshToken;
  }

  @override
  Future<void> clear() async {
    _access = null;
    _refresh = null;
  }
}

/// A scripted auth repo. `user` is whoever the verified code belongs to — the test sets a
/// customer or a delivery partner to prove role-based landing.
class _FakeAuthRepository implements AuthRepository {
  _FakeAuthRepository(this.user);
  final AuthUser user;
  int otpRequests = 0;

  @override
  Future<ApiFailure?> requestOtp(String phone) async {
    otpRequests++;
    return null;
  }

  @override
  Future<(Session?, ApiFailure?)> verifyOtp({required String phone, required String code}) async {
    return (const Session(accessToken: 'a', refreshToken: 'r'), null);
  }

  @override
  Future<(AuthUser?, ApiFailure?)> fetchCurrentUser() async => (user, null);

  @override
  Future<void> logout() async {}
}

/// An adapter that answers every request instantly (503), so the shell's feature tabs resolve to
/// an error state at once rather than making a real network call that would leave a pending timer
/// at test teardown. The auth flow itself uses the fake repository, not Dio.
class _OfflineAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async => ResponseBody.fromString('{}', 503);

  @override
  void close({bool force = false}) {}
}

/// The partner shell starts the connectivity watcher, which subscribes to the `connectivity_plus`
/// plugin's event stream — unavailable in a widget test and a source of a pending platform timer at
/// teardown. Override it with a no-op: the shell still renders, and the queue's on-start drain is
/// exercised by the dedicated sync tests, not here.
class _NoopConnectivitySync extends ConnectivitySync {
  @override
  void build() {}
}

/// The partner shell also opens two Drift `.watch()` streams for the pending-sync UI. Those streams
/// leave a pending timer in the test binding at teardown; this routing test doesn't exercise the
/// sync UI (that is covered by the sync-queue tests), so stub them with static, drained streams.
final _partnerStreamOverrides = [
  pendingSyncCountProvider.overrideWith((ref) => Stream.value(0)),
  pendingSyncByTargetProvider.overrideWith((ref) => Stream.value(const {})),
];

Widget _app(AuthUser user) {
  return ProviderScope(
    overrides: [
      appDatabaseProvider.overrideWith((ref) {
        final db = AppDatabase.forTesting(NativeDatabase.memory());
        ref.onDispose(db.close); // close it with the container, so the next test starts clean
        return db;
      }),
      dioProvider.overrideWith((ref) => Dio()..httpClientAdapter = _OfflineAdapter()),
      tokenStoreProvider.overrideWithValue(_FakeTokenStore()),
      authRepositoryProvider.overrideWithValue(_FakeAuthRepository(user)),
      connectivitySyncProvider.overrideWith(_NoopConnectivitySync.new),
      ..._partnerStreamOverrides,
    ],
    child: const CpeApp(),
  );
}

const _customer = AuthUser(id: 'u1', phone: '+919876543210', role: UserRole.customer, name: 'Asha');
const _partner = AuthUser(id: 'p1', phone: '+919000000000', role: UserRole.deliveryPartner);

void main() {
  testWidgets('an unauthenticated cold start lands on the login screen', (tester) async {
    await tester.pumpWidget(_app(_customer));
    await tester.pumpAndSettle();

    expect(find.text('Welcome'), findsOneWidget);
    expect(find.widgetWithText(TextField, ''), findsWidgets); // the phone field exists
  });

  testWidgets('full customer flow: phone -> code -> customer home', (tester) async {
    await tester.pumpWidget(_app(_customer));
    await tester.pumpAndSettle();

    // Enter a phone and request the code.
    await tester.enterText(find.byType(TextFormField), '+919876543210');
    await tester.tap(find.widgetWithText(FilledButton, 'Send code'));
    await tester.pumpAndSettle();

    // OTP screen.
    expect(find.text('Enter code'), findsOneWidget);
    await tester.enterText(find.byType(TextFormField), '123456');
    await tester.tap(find.widgetWithText(FilledButton, 'Verify'));
    await tester.pump(); // let the auth state flip
    await tester.pump(const Duration(milliseconds: 100)); // and the redirect settle

    // Authenticated -> the router redirect drops us on the CUSTOMER shell (Papers tab + bottom nav).
    expect(find.text('My papers'), findsOneWidget);
    expect(find.byType(NavigationBar), findsOneWidget);
  });

  testWidgets('a delivery partner lands on the PARTNER shell (role-based navigation)', (
    tester,
  ) async {
    await tester.pumpWidget(_app(_partner));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextFormField), '+919000000000');
    await tester.tap(find.widgetWithText(FilledButton, 'Send code'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextFormField), '654321');
    await tester.tap(find.widgetWithText(FilledButton, 'Verify'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    // Authenticated as a partner -> the PARTNER shell (route tab), not the customer's Papers tab.
    expect(find.text("Today's route"), findsOneWidget);
    expect(find.text('My papers'), findsNothing);
  });

  testWidgets('login validates the phone number before requesting a code', (tester) async {
    await tester.pumpWidget(_app(_customer));
    await tester.pumpAndSettle();

    // Too short: tapping send shows a validation error and does NOT navigate.
    await tester.enterText(find.byType(TextFormField), '123');
    await tester.tap(find.widgetWithText(FilledButton, 'Send code'));
    await tester.pumpAndSettle();

    expect(find.text('Enter a valid phone number'), findsOneWidget);
    expect(find.text('Enter code'), findsNothing);
  });
}
