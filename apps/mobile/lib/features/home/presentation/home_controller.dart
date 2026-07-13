import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../data/app_status_repository_impl.dart';
import '../domain/app_status.dart';

part 'home_controller.g.dart';

/// The presentation layer talks to the repository *interface*, never to Dio.
///
/// `AsyncValue` gives the screen its loading / data / error states for free, which
/// is what the Phase 12 rule ("every screen has explicit loading, empty and error
/// states") is built on.
@riverpod
class HomeController extends _$HomeController {
  @override
  Future<AppStatus> build() async {
    final repository = ref.watch(appStatusRepositoryProvider);
    final (status, failure) = await repository.fetchStatus();

    if (failure != null) {
      // Rethrowing puts it in AsyncValue.error, where the widget must handle it.
      throw failure;
    }

    return status!;
  }

  Future<void> refresh() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(build);
  }
}
