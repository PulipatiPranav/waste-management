import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_failure.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/async_value_view.dart';
import '../../../core/widgets/empty_state.dart';
import '../../wallet/presentation/wallet_controllers.dart';
import '../data/marketplace_dtos.dart';
import '../data/marketplace_repository.dart';

class CartScreen extends ConsumerStatefulWidget {
  const CartScreen({super.key});

  @override
  ConsumerState<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends ConsumerState<CartScreen> {
  bool _useWallet = true;
  bool _checkingOut = false;

  @override
  Widget build(BuildContext context) {
    final cartValue = ref.watch(cartProvider);
    final walletValue = ref.watch(walletBalanceProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Cart')),
      body: AsyncValueView<CartDto>(
        value: cartValue,
        onRetry: () => ref.invalidate(cartProvider),
        data: (cart) {
          if (cart.lines.isEmpty) {
            return const EmptyState(
              title: 'Your cart is empty',
              message: 'Add something from the shop to get started.',
              icon: Icons.shopping_cart_outlined,
            );
          }
          return Column(
            children: [
              Expanded(
                child: ListView.separated(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  itemCount: cart.lines.length,
                  separatorBuilder: (_, _) => const Divider(),
                  itemBuilder: (context, i) => _CartLine(line: cart.lines[i]),
                ),
              ),
              _CheckoutBar(
                subtotalRupees: cart.subtotalRupees,
                walletBalancePaise: int.tryParse(walletValue.value?.balancePaise ?? '0') ?? 0,
                walletRupees: walletValue.value?.balanceRupees,
                useWallet: _useWallet,
                onToggleWallet: (v) => setState(() => _useWallet = v),
                checkingOut: _checkingOut,
                onCheckout: () => _checkout(cart),
              ),
            ],
          );
        },
      ),
    );
  }

  Future<void> _checkout(CartDto cart) async {
    setState(() => _checkingOut = true);
    final walletBalancePaise =
        int.tryParse(ref.read(walletBalanceProvider).value?.balancePaise ?? '0') ?? 0;

    final (result, failure) = await ref
        .read(marketplaceRepositoryProvider)
        .checkout(requestedWalletPaise: _useWallet ? walletBalancePaise : 0);

    if (!mounted) return;
    setState(() => _checkingOut = false);

    if (failure != null || result == null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(_messageFor(failure))));
      return;
    }

    ref
      ..invalidate(cartProvider)
      ..invalidate(walletBalanceProvider)
      ..invalidate(ordersProvider);

    final gateway = result.gateway;
    if (gateway == null) {
      // Fully paid from the wallet — the order is confirmed.
      await _dialog('Order confirmed', 'Paid ${result.order.totalRupees} from your wallet.');
    } else {
      // A card amount remains. In-app card payment (the Razorpay SDK) is a later step; the order
      // is saved and awaits payment. Honest about what is and is not wired.
      final remaining = (gateway.amountPaise / 100).toStringAsFixed(2);
      await _dialog(
        'Almost there',
        '₹$remaining still needs to be paid by card. Card payment in the app is coming soon; '
            'your order is saved and waiting.',
      );
    }
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _dialog(String title, String message) {
    return showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('OK'))],
      ),
    );
  }

  String _messageFor(ApiFailure? f) => switch (f) {
    NetworkFailure() => "Can't reach the server.",
    TimeoutFailure() => 'The server took too long.',
    BadRequestFailure(:final message) => message,
    ServerFailure(:final message) => message,
    UnauthorizedFailure() => 'Please sign in again.',
    null => 'Checkout could not be completed.',
  };
}

class _CartLine extends ConsumerWidget {
  const _CartLine({required this.line});
  final CartLineDto line;

  Future<void> _setQuantity(WidgetRef ref, int quantity) async {
    final (cart, _) = await ref
        .read(marketplaceRepositoryProvider)
        .setQuantity(line.variantId, quantity);
    if (cart != null) ref.invalidate(cartProvider);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(line.productName, style: theme.textTheme.titleMedium),
              Text(
                line.variantName,
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline),
              ),
              Text(line.lineTotalRupees, style: theme.textTheme.bodyMedium),
            ],
          ),
        ),
        IconButton(
          icon: const Icon(Icons.remove_circle_outline),
          onPressed: () => _setQuantity(ref, line.quantity - 1), // quantity 0 removes the line
        ),
        Text('${line.quantity}', style: theme.textTheme.titleMedium),
        IconButton(
          icon: const Icon(Icons.add_circle_outline),
          onPressed: line.quantity >= line.availableStock
              ? null
              : () => _setQuantity(ref, line.quantity + 1),
        ),
      ],
    );
  }
}

class _CheckoutBar extends StatelessWidget {
  const _CheckoutBar({
    required this.subtotalRupees,
    required this.walletBalancePaise,
    required this.walletRupees,
    required this.useWallet,
    required this.onToggleWallet,
    required this.checkingOut,
    required this.onCheckout,
  });

  final String subtotalRupees;
  final int walletBalancePaise;
  final String? walletRupees;
  final bool useWallet;
  final ValueChanged<bool> onToggleWallet;
  final bool checkingOut;
  final VoidCallback onCheckout;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SafeArea(
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: theme.colorScheme.surface,
          border: Border(top: BorderSide(color: theme.colorScheme.outlineVariant)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (walletBalancePaise > 0)
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Pay with wallet balance'),
                subtitle: Text('${walletRupees ?? ''} available'),
                value: useWallet,
                onChanged: checkingOut ? null : onToggleWallet,
              ),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Subtotal', style: theme.textTheme.titleMedium),
                Text(subtotalRupees, style: theme.textTheme.titleMedium),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            AppButton(label: 'Check out', onPressed: onCheckout, isLoading: checkingOut),
          ],
        ),
      ),
    );
  }
}
