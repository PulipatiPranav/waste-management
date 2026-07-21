import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_failure.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/async_value_view.dart';
import '../../../core/widgets/empty_state.dart';
import '../data/marketplace_dtos.dart';
import '../data/marketplace_repository.dart';
import 'cart_screen.dart';
import 'orders_screen.dart';

/// Browse recycled-paper goods and add them to the cart. Products from verified sellers only —
/// that filtering is the server's job; the app just renders what it is given.
class ShopScreen extends ConsumerWidget {
  const ShopScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final productsValue = ref.watch(productsProvider);
    final cartValue = ref.watch(cartProvider);
    final cartCount = cartValue.value?.lines.length ?? 0;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Shop'),
        actions: [
          IconButton(
            icon: const Icon(Icons.receipt_long_outlined),
            tooltip: 'My orders',
            onPressed: () => Navigator.of(
              context,
            ).push<void>(MaterialPageRoute<void>(builder: (_) => const OrdersScreen())),
          ),
          _CartButton(count: cartCount),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(productsProvider);
          await ref.read(productsProvider.future);
        },
        child: AsyncValueView<List<ProductDto>>(
          value: productsValue,
          onRetry: () => ref.invalidate(productsProvider),
          data: (products) => products.isEmpty
              ? const EmptyState(
                  title: 'Nothing in the shop yet',
                  message: 'Recycled-paper goods will appear here soon.',
                  icon: Icons.storefront_outlined,
                )
              : ListView.separated(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  itemCount: products.length,
                  separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.md),
                  itemBuilder: (context, i) => _ProductCard(products[i]),
                ),
        ),
      ),
    );
  }
}

class _CartButton extends StatelessWidget {
  const _CartButton({required this.count});
  final int count;

  @override
  Widget build(BuildContext context) {
    return Stack(
      alignment: Alignment.center,
      children: [
        IconButton(
          icon: const Icon(Icons.shopping_cart_outlined),
          tooltip: 'Cart',
          onPressed: () => Navigator.of(
            context,
          ).push<void>(MaterialPageRoute<void>(builder: (_) => const CartScreen())),
        ),
        if (count > 0)
          Positioned(
            right: 6,
            top: 6,
            child: Container(
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.error,
                shape: BoxShape.circle,
              ),
              child: Text(
                '$count',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 10,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _ProductCard extends ConsumerWidget {
  const _ProductCard(this.product);
  final ProductDto product;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(product.name, style: theme.textTheme.titleMedium),
          Text(
            'by ${product.sellerName}',
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline),
          ),
          if (product.recycledContent != null) ...[
            const SizedBox(height: AppSpacing.xs),
            Text(product.recycledContent!, style: theme.textTheme.bodySmall),
          ],
          const Divider(height: AppSpacing.lg),
          for (final variant in product.variants.where((v) => v.isActive))
            _VariantRow(variant: variant),
        ],
      ),
    );
  }
}

class _VariantRow extends ConsumerStatefulWidget {
  const _VariantRow({required this.variant});
  final VariantDto variant;

  @override
  ConsumerState<_VariantRow> createState() => _VariantRowState();
}

class _VariantRowState extends ConsumerState<_VariantRow> {
  bool _adding = false;

  Future<void> _add() async {
    setState(() => _adding = true);
    final (cart, failure) = await ref
        .read(marketplaceRepositoryProvider)
        .addToCart(widget.variant.id, 1);
    if (!mounted) return;
    setState(() => _adding = false);
    if (failure == null && cart != null) {
      ref.invalidate(cartProvider);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Added to cart')));
    } else {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(_messageFor(failure))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final v = widget.variant;
    final soldOut = v.stock <= 0;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(v.name),
                Text(
                  soldOut ? 'Sold out' : v.priceRupees,
                  style: TextStyle(color: soldOut ? Theme.of(context).colorScheme.error : null),
                ),
              ],
            ),
          ),
          if (_adding)
            const SizedBox(height: 24, width: 24, child: CircularProgressIndicator(strokeWidth: 2))
          else
            IconButton.filledTonal(
              onPressed: soldOut ? null : _add,
              icon: const Icon(Icons.add_shopping_cart),
            ),
        ],
      ),
    );
  }

  String _messageFor(ApiFailure? f) => switch (f) {
    NetworkFailure() => "Can't reach the server.",
    TimeoutFailure() => 'The server took too long.',
    BadRequestFailure(:final message) => message,
    ServerFailure(:final message) => message,
    UnauthorizedFailure() => 'Please sign in again.',
    null => 'Could not add to cart.',
  };
}
