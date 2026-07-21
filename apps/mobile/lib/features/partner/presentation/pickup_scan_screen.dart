import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../../core/network/api_failure.dart';
import '../../../core/theme/app_theme.dart';
import '../data/partner_repository.dart';
import 'weigh_pickup_screen.dart';

/// Scan the QR the customer shows to open their pickup for weighing. Scanning needs a connection
/// (it looks the pickup up by token); the WEIGHING and completion afterwards are offline-resilient,
/// which is the part that must never be lost. A manual token entry is offered as a fallback when
/// the camera cannot read the code.
class PickupScanScreen extends ConsumerStatefulWidget {
  const PickupScanScreen({super.key});

  @override
  ConsumerState<PickupScanScreen> createState() => _PickupScanScreenState();
}

class _PickupScanScreenState extends ConsumerState<PickupScanScreen> {
  bool _handling = false;
  String? _error;

  Future<void> _onToken(String token) async {
    if (_handling) return;
    setState(() {
      _handling = true;
      _error = null;
    });

    final (pickup, failure) = await ref.read(partnerRepositoryProvider).scanPickup(token);
    if (!mounted) return;

    if (failure != null || pickup == null) {
      setState(() {
        _handling = false;
        _error = _messageFor(failure);
      });
      return;
    }

    await Navigator.of(
      context,
    ).push<void>(MaterialPageRoute<void>(builder: (_) => WeighPickupScreen(pickup: pickup)));
    if (mounted) setState(() => _handling = false);
  }

  Future<void> _manualEntry() async {
    final controller = TextEditingController();
    final token = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Enter pickup code'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(hintText: 'Pickup QR token'),
          autofocus: true,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Open'),
          ),
        ],
      ),
    );
    if (token != null && token.isNotEmpty) await _onToken(token);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Scan pickup'),
        actions: [
          IconButton(
            icon: const Icon(Icons.keyboard),
            tooltip: 'Enter code manually',
            onPressed: _handling ? null : _manualEntry,
          ),
        ],
      ),
      body: Stack(
        children: [
          MobileScanner(
            onDetect: (capture) {
              final code = capture.barcodes.firstOrNull?.rawValue;
              if (code != null && code.isNotEmpty) _onToken(code);
            },
          ),
          if (_handling)
            const ColoredBox(
              color: Colors.black54,
              child: Center(child: CircularProgressIndicator()),
            ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: Container(
              color: Colors.black.withValues(alpha: 0.5),
              padding: const EdgeInsets.all(AppSpacing.md),
              child: Text(
                _error ?? 'Point the camera at the customer’s pickup QR code.',
                textAlign: TextAlign.center,
                style: TextStyle(color: _error != null ? Colors.redAccent : Colors.white),
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _messageFor(ApiFailure? failure) => switch (failure) {
    NetworkFailure() => 'You need a connection to open a pickup. Try again in range.',
    TimeoutFailure() => 'The server took too long. Try again.',
    BadRequestFailure(:final message) => message,
    ServerFailure(:final message) => message,
    UnauthorizedFailure() => 'Please sign in again.',
    null => 'That code did not match a pickup.',
  };
}
