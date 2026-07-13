import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../features/home/presentation/home_screen.dart';

part 'app_router.g.dart';

/// Route paths as constants — a typo in a string literal is a runtime 404, and a
/// deep link that silently dead-ends is a bug nobody notices until a user reports it.
abstract final class Routes {
  static const home = '/';
}

@Riverpod(keepAlive: true)
GoRouter appRouter(Ref ref) {
  return GoRouter(
    initialLocation: Routes.home,
    debugLogDiagnostics: true,
    routes: [
      GoRoute(path: Routes.home, name: 'home', builder: (context, state) => const HomeScreen()),
    ],
    // Phase 11 adds `redirect:` here, watching the auth provider: unauthenticated
    // users to /login, delivery partners to the partner shell. Kept out now so no
    // route pretends to be guarded when nothing is.
    errorBuilder: (context, state) =>
        Scaffold(body: Center(child: Text('Route not found: ${state.uri}'))),
  );
}
