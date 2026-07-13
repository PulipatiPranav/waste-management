import '../../../core/network/api_failure.dart';
import 'app_status.dart';

/// The port the presentation layer depends on.
///
/// It is declared in `domain/` and implemented in `data/` — dependencies point
/// inward. A widget never imports Dio, so a test overrides this with a fake and no
/// HTTP mock server is needed; swapping Dio for something else later touches `data/`
/// only.
///
/// Errors are returned, not thrown: `ApiFailure` in the signature is what makes the
/// compiler force each caller to handle the offline case.
abstract interface class AppStatusRepository {
  Future<(AppStatus?, ApiFailure?)> fetchStatus();
}
