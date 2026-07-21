import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/app_button.dart';
import '../../pickups/data/pickup_dtos.dart';
import '../data/partner_dtos.dart';
import '../data/partner_repository.dart';
import '../sync/syncer.dart';

/// Manual weight entry per paper type — the UI face of Phase 4's manual `WeighingDeviceReader`. A
/// partner adds a row per paper type, keys the grams, optionally gets an estimate (online), and
/// completes. Completion is OFFLINE-FIRST: it is queued and synced later, so weighing paper in a
/// basement with no signal still credits the customer once a connection returns.
class WeighPickupScreen extends ConsumerStatefulWidget {
  const WeighPickupScreen({required this.pickup, super.key});

  final PickupDto pickup;

  @override
  ConsumerState<WeighPickupScreen> createState() => _WeighPickupScreenState();
}

class _WeighRow {
  _WeighRow(this.paperType);
  String paperType;
  final controller = TextEditingController();
}

class _WeighPickupScreenState extends ConsumerState<WeighPickupScreen> {
  final _rows = [_WeighRow('NEWSPAPER')];
  QuoteDto? _estimate;
  bool _estimating = false;
  bool _submitting = false;

  @override
  void dispose() {
    for (final r in _rows) {
      r.controller.dispose();
    }
    super.dispose();
  }

  List<WeightEntry> _entries() => [
    for (final row in _rows)
      if ((int.tryParse(row.controller.text.trim()) ?? 0) > 0)
        WeightEntry(paperType: row.paperType, weightGrams: int.parse(row.controller.text.trim())),
  ];

  Future<void> _estimateCashback() async {
    final entries = _entries();
    if (entries.isEmpty) return;
    setState(() => _estimating = true);
    final (quote, _) = await ref.read(partnerRepositoryProvider).quotePickup(entries);
    if (!mounted) return;
    setState(() {
      _estimating = false;
      _estimate = quote;
    });
  }

  Future<void> _complete() async {
    final entries = _entries();
    if (entries.isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Enter at least one weight.')));
      return;
    }
    setState(() => _submitting = true);
    await ref.read(syncerProvider).submitPickupCompletion(widget.pickup.id, entries);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Pickup recorded. It will sync when you have a connection.')),
    );
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Weigh pickup')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Weights', style: theme.textTheme.titleMedium),
              const SizedBox(height: AppSpacing.sm),
              for (var i = 0; i < _rows.length; i++) _row(i),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: () => setState(() => _rows.add(_WeighRow('OTHER'))),
                  icon: const Icon(Icons.add),
                  label: const Text('Add paper type'),
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              if (_estimate != null)
                Card(
                  color: theme.colorScheme.primaryContainer,
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Estimated cashback', style: theme.textTheme.titleMedium),
                        Text(_estimate!.totalRupees, style: theme.textTheme.titleMedium),
                      ],
                    ),
                  ),
                ),
              const SizedBox(height: AppSpacing.md),
              AppButton(
                label: 'Estimate cashback',
                icon: Icons.calculate_outlined,
                variant: AppButtonVariant.secondary,
                onPressed: _estimateCashback,
                isLoading: _estimating,
              ),
              const SizedBox(height: AppSpacing.sm),
              AppButton(label: 'Complete pickup', onPressed: _complete, isLoading: _submitting),
            ],
          ),
        ),
      ),
    );
  }

  Widget _row(int index) {
    final row = _rows[index];
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Row(
        children: [
          Expanded(
            flex: 3,
            child: DropdownButtonFormField<String>(
              initialValue: row.paperType,
              decoration: const InputDecoration(labelText: 'Type'),
              items: [
                for (final entry in paperTypes.entries)
                  DropdownMenuItem(value: entry.key, child: Text(entry.value)),
              ],
              onChanged: (v) => setState(() => row.paperType = v ?? row.paperType),
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            flex: 2,
            child: TextField(
              controller: row.controller,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(labelText: 'Grams', suffixText: 'g'),
              onChanged: (_) => setState(() => _estimate = null),
            ),
          ),
          if (_rows.length > 1)
            IconButton(
              icon: const Icon(Icons.remove_circle_outline),
              onPressed: () => setState(() => _rows.removeAt(index)),
            ),
        ],
      ),
    );
  }
}
