import 'package:freezed_annotation/freezed_annotation.dart';

part 'app_status.freezed.dart';

/// A domain entity: pure Dart, no Dio, no Drift, no Flutter.
///
/// That purity is the rule for everything under `domain/`. It means the business
/// rules in later phases (subscription state machine, cashback calculation) can be
/// unit-tested without a widget tree or an HTTP mock, and it keeps the app's core
/// independent of the packages we happen to use this year.
@freezed
abstract class AppStatus with _$AppStatus {
  const factory AppStatus({
    required bool apiReachable,
    required String environment,
    DateTime? lastCheckedAt,
  }) = _AppStatus;

  const AppStatus._();

  bool get isHealthy => apiReachable;
}
