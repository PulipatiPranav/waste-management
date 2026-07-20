import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../features/auth/domain/auth_state.dart';
import '../../features/auth/presentation/auth_controller.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/auth/presentation/otp_screen.dart';
import '../../features/shell/presentation/customer_home_screen.dart';
import '../../features/shell/presentation/partner_home_screen.dart';
import '../../features/shell/presentation/splash_screen.dart';

part 'app_router.g.dart';

/// Route paths as constants — a typo in a string literal is a runtime 404, and a
/// deep link that silently dead-ends is a bug nobody notices until a user reports it.
abstract final class Routes {
  static const splash = '/splash';
  static const login = '/login';
  static const otp = '/otp';
  static const home = '/home';
  static const partner = '/partner';
}

/// The router, and THE place auth is enforced. The redirect is the single guard:
///
///   - state UNKNOWN (cold start, token not yet checked) -> hold on the splash, redirect
///     nowhere. This is what stops a returning user flashing past the login screen.
///   - UNAUTHENTICATED -> /login (unless already in the login/otp flow).
///   - AUTHENTICATED -> out of splash/login and into the role's home. This build is ONE app
///     with role-based navigation (see the README): a delivery partner lands on /partner,
///     everyone else on /home, and /partner is guarded so a customer cannot reach it.
///
/// `refreshListenable` is a plain [ValueNotifier] fed by a provider LISTENER (not a watch),
/// so an auth change re-runs the redirect WITHOUT rebuilding the GoRouter and losing the
/// navigation stack.
@Riverpod(keepAlive: true)
GoRouter appRouter(Ref ref) {
  final refresh = ValueNotifier<AuthState>(ref.read(authControllerProvider));
  ref.listen(authControllerProvider, (_, next) => refresh.value = next);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: Routes.splash,
    debugLogDiagnostics: true,
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      final location = state.matchedLocation;
      final inLoginFlow = location == Routes.login || location == Routes.otp;

      if (!auth.isResolved) {
        return location == Routes.splash ? null : Routes.splash;
      }

      if (!auth.isAuthenticated) {
        return inLoginFlow ? null : Routes.login;
      }

      // Authenticated. Decide the role's home once.
      final isPartner = auth.userOrNull?.role.isDeliveryPartner ?? false;
      final roleHome = isPartner ? Routes.partner : Routes.home;

      // Bounce off the pre-auth screens onto the role home.
      if (location == Routes.splash || inLoginFlow) return roleHome;

      // Role guard: only a delivery partner may sit on partner routes.
      if (location.startsWith(Routes.partner) && !isPartner) return Routes.home;

      return null;
    },
    routes: [
      GoRoute(
        path: Routes.splash,
        name: 'splash',
        builder: (context, state) => const SplashScreen(),
      ),
      GoRoute(path: Routes.login, name: 'login', builder: (context, state) => const LoginScreen()),
      GoRoute(
        path: Routes.otp,
        name: 'otp',
        builder: (context, state) => OtpScreen(phone: state.uri.queryParameters['phone'] ?? ''),
      ),
      GoRoute(
        path: Routes.home,
        name: 'home',
        builder: (context, state) => const CustomerHomeScreen(),
      ),
      GoRoute(
        path: Routes.partner,
        name: 'partner',
        builder: (context, state) => const PartnerHomeScreen(),
      ),
    ],
    errorBuilder: (context, state) =>
        Scaffold(body: Center(child: Text('Route not found: ${state.uri}'))),
  );
}
