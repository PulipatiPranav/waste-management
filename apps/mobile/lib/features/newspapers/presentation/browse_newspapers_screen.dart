import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/async_value_view.dart';
import '../../../core/widgets/empty_state.dart';
import '../data/catalog_dtos.dart';
import '../data/catalog_repository.dart';
import 'subscribe_screen.dart';

/// Browse subscribable editions, filterable by pincode (which is how availability actually works —
/// a paper is delivered in some cities, not others).
class BrowseNewspapersScreen extends ConsumerStatefulWidget {
  const BrowseNewspapersScreen({super.key});

  @override
  ConsumerState<BrowseNewspapersScreen> createState() => _BrowseNewspapersScreenState();
}

class _BrowseNewspapersScreenState extends ConsumerState<BrowseNewspapersScreen> {
  String? _pincode;

  @override
  Widget build(BuildContext context) {
    final editionsValue = ref.watch(editionsProvider(pincode: _pincode));

    return Scaffold(
      appBar: AppBar(title: const Text('Browse newspapers')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: TextField(
              keyboardType: TextInputType.number,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(6),
              ],
              decoration: const InputDecoration(
                labelText: 'Filter by pincode',
                prefixIcon: Icon(Icons.search),
                hintText: 'e.g. 560001',
              ),
              onChanged: (v) =>
                  setState(() => _pincode = v.length == 6 ? v : (v.isEmpty ? null : _pincode)),
            ),
          ),
          Expanded(
            child: AsyncValueView<List<EditionDto>>(
              value: editionsValue,
              onRetry: () => ref.invalidate(editionsProvider(pincode: _pincode)),
              data: (editions) {
                if (editions.isEmpty) {
                  return const EmptyState(
                    title: 'Nothing available here',
                    message: 'No subscribable newspapers for this filter yet.',
                    icon: Icons.newspaper_outlined,
                  );
                }
                return ListView.separated(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  itemCount: editions.length,
                  separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.sm),
                  itemBuilder: (context, i) => _EditionCard(editions[i]),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _EditionCard extends StatelessWidget {
  const _EditionCard(this.edition);
  final EditionDto edition;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return AppCard(
      onTap: () => Navigator.of(
        context,
      ).push<void>(MaterialPageRoute<void>(builder: (_) => SubscribeScreen(edition: edition))),
      child: Row(
        children: [
          CircleAvatar(
            backgroundColor: theme.colorScheme.secondaryContainer,
            child: const Icon(Icons.newspaper),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(edition.newspaper.name, style: theme.textTheme.titleMedium),
                Text(
                  '${edition.city} · ${edition.newspaper.language.toLowerCase()}',
                  style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.outline),
                ),
              ],
            ),
          ),
          Text('${edition.pricePerIssueRupees}/issue', style: theme.textTheme.labelLarge),
        ],
      ),
    );
  }
}
