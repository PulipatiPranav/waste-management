import 'package:flutter/material.dart';

/// A small coloured status pill, shared across pickups, subscriptions and orders so a status reads
/// the same everywhere. Colour is by SEMANTICS (good / waiting / bad / neutral), not by the exact
/// string, so a new status slots in without a redesign.
enum _Tone { good, wait, bad, neutral }

class StatusChip extends StatelessWidget {
  const StatusChip(this.status, {super.key});

  final String status;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (bg, fg) = switch (_toneFor(status)) {
      _Tone.good => (scheme.primaryContainer, scheme.onPrimaryContainer),
      _Tone.wait => (scheme.tertiaryContainer, scheme.onTertiaryContainer),
      _Tone.bad => (scheme.errorContainer, scheme.onErrorContainer),
      _Tone.neutral => (scheme.surfaceContainerHighest, scheme.onSurfaceVariant),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child: Text(
        _label(status),
        style: Theme.of(
          context,
        ).textTheme.labelSmall?.copyWith(color: fg, fontWeight: FontWeight.w600),
      ),
    );
  }

  _Tone _toneFor(String s) => switch (s.toUpperCase()) {
    'ACTIVE' || 'COMPLETED' || 'DELIVERED' || 'CONFIRMED' || 'PAID' || 'APPROVED' => _Tone.good,
    'PENDING_PAYMENT' || 'REQUESTED' || 'ASSIGNED' || 'PAUSED' || 'SHIPPED' => _Tone.wait,
    'CANCELLED' || 'FAILED' || 'REJECTED' => _Tone.bad,
    _ => _Tone.neutral,
  };

  String _label(String s) => s
      .replaceAll('_', ' ')
      .toLowerCase()
      .replaceFirstMapped(RegExp('^.'), (m) => m[0]!.toUpperCase());
}
