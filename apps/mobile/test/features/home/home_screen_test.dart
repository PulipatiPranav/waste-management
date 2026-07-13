import 'package:cpe_mobile/core/network/api_failure.dart';
import 'package:cpe_mobile/features/home/data/app_status_repository_impl.dart';
import 'package:cpe_mobile/features/home/domain/app_status.dart';
import 'package:cpe_mobile/features/home/domain/app_status_repository.dart';
import 'package:cpe_mobile/features/home/presentation/home_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// Fakes the repository *interface*. No HTTP mock, no running API.
///
/// This is the payoff from the domain/data split: the widget under test depends on
/// an abstraction, so the test controls it directly.
class _FakeRepository implements AppStatusRepository {
  _FakeRepository(this._result);

  final (AppStatus?, ApiFailure?) _result;

  @override
  Future<(AppStatus?, ApiFailure?)> fetchStatus() async => _result;
}

Widget _harness((AppStatus?, ApiFailure?) result) {
  return ProviderScope(
    overrides: [appStatusRepositoryProvider.overrideWithValue(_FakeRepository(result))],
    child: const MaterialApp(home: HomeScreen()),
  );
}

void main() {
  testWidgets('shows a loading indicator before the status resolves', (tester) async {
    await tester.pumpWidget(
      _harness((const AppStatus(apiReachable: true, environment: 'test'), null)),
    );

    // One frame only — the future has not completed yet.
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    await tester.pumpAndSettle();
  });

  testWidgets('renders the status once the API responds', (tester) async {
    await tester.pumpWidget(
      _harness((const AppStatus(apiReachable: true, environment: 'test'), null)),
    );
    await tester.pumpAndSettle();

    expect(find.text('API reachable'), findsOneWidget);
    expect(find.text('Environment: test'), findsOneWidget);
  });

  testWidgets('shows an offline message and a retry action when the network is down', (
    tester,
  ) async {
    await tester.pumpWidget(_harness((null, const ApiFailure.network())));
    await tester.pumpAndSettle();

    expect(find.textContaining("Can't reach the server"), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Retry'), findsOneWidget);
  });

  testWidgets('surfaces the API message on a bad request', (tester) async {
    await tester.pumpWidget(
      _harness((
        null,
        const ApiFailure.badRequest(code: 'PICKUP_ALREADY_COMPLETED', message: 'Already done'),
      )),
    );
    await tester.pumpAndSettle();

    expect(find.text('Already done'), findsOneWidget);
  });
}
