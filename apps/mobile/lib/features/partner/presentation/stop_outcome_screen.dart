import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/app_button.dart';
import '../data/partner_dtos.dart';
import '../data/partner_repository.dart';
import '../sync/syncer.dart';

/// Record a stop's outcome. DELIVERED needs no reason; FAILED/SKIPPED require one (the backend
/// enforces this too). A photo is optional proof.
///
/// The record is OFFLINE-FIRST: on submit it is queued durably and synced when possible, so a
/// partner at a gate with no signal is never blocked and never left wondering — the run list shows
/// "pending sync" until it lands. The only online-only step is the photo upload (it needs the
/// network to return a key); if that fails, the outcome is still recorded, just without a photo.
class StopOutcomeScreen extends ConsumerStatefulWidget {
  const StopOutcomeScreen({required this.stop, super.key});

  final StopDto stop;

  @override
  ConsumerState<StopOutcomeScreen> createState() => _StopOutcomeScreenState();
}

class _StopOutcomeScreenState extends ConsumerState<StopOutcomeScreen> {
  String _outcome = 'DELIVERED';
  final _reason = TextEditingController();
  String? _photoKey;
  bool _uploadingPhoto = false;
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  bool get _needsReason => _outcome == 'FAILED' || _outcome == 'SKIPPED';

  Future<void> _addPhoto() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.camera, imageQuality: 70);
    if (picked == null || !mounted) return;

    setState(() => _uploadingPhoto = true);
    final (key, failure) = await ref
        .read(partnerRepositoryProvider)
        .uploadPhoto(widget.stop.id, picked.path);
    if (!mounted) return;
    setState(() {
      _uploadingPhoto = false;
      _photoKey = key;
    });
    if (failure != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Photo needs a connection; outcome will still be recorded.')),
      );
    }
  }

  Future<void> _submit() async {
    if (_needsReason && _reason.text.trim().isEmpty) {
      setState(() => _error = 'A reason is required for ${_outcome.toLowerCase()}.');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });

    await ref
        .read(syncerProvider)
        .submitDeliveryOutcome(
          widget.stop.id,
          outcome: _outcome,
          reason: _needsReason ? _reason.text.trim() : null,
          photoKey: _photoKey,
        );

    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Recorded. It will sync when you have a connection.')),
    );
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text('Stop ${widget.stop.sequence}')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Outcome', style: theme.textTheme.titleMedium),
              const SizedBox(height: AppSpacing.sm),
              Wrap(
                spacing: AppSpacing.sm,
                children: [
                  for (final entry in stopOutcomes.entries)
                    ChoiceChip(
                      label: Text(entry.value),
                      selected: _outcome == entry.key,
                      onSelected: (_) => setState(() => _outcome = entry.key),
                    ),
                ],
              ),
              if (_needsReason) ...[
                const SizedBox(height: AppSpacing.lg),
                TextField(
                  controller: _reason,
                  decoration: const InputDecoration(
                    labelText: 'Reason',
                    hintText: 'Gate locked, nobody answered…',
                  ),
                  maxLines: 2,
                ),
              ],
              const SizedBox(height: AppSpacing.lg),
              Text('Photo proof (optional)', style: theme.textTheme.titleMedium),
              const SizedBox(height: AppSpacing.sm),
              if (_uploadingPhoto)
                const Center(child: CircularProgressIndicator())
              else if (_photoKey != null)
                Row(
                  children: [
                    Icon(Icons.check_circle, color: theme.colorScheme.primary),
                    const SizedBox(width: AppSpacing.sm),
                    const Text('Photo attached'),
                  ],
                )
              else
                AppButton(
                  label: 'Take photo',
                  icon: Icons.camera_alt_outlined,
                  variant: AppButtonVariant.secondary,
                  onPressed: _addPhoto,
                ),
              if (_error != null) ...[
                const SizedBox(height: AppSpacing.md),
                Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
              ],
              const SizedBox(height: AppSpacing.xl),
              AppButton(label: 'Record outcome', onPressed: _submit, isLoading: _submitting),
            ],
          ),
        ),
      ),
    );
  }
}
