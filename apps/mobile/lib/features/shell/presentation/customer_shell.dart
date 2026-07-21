import 'package:flutter/material.dart';

import '../../impact/presentation/impact_screen.dart';
import '../../marketplace/presentation/shop_screen.dart';
import '../../newspapers/presentation/papers_screen.dart';
import '../../pickups/presentation/pickups_screen.dart';
import '../../wallet/presentation/wallet_screen.dart';

/// The authenticated customer shell: five tabs in an [IndexedStack] so each keeps its scroll
/// position and does not rebuild when you switch away. Each tab is a self-contained feature screen
/// with its own app bar and states.
class CustomerShell extends StatefulWidget {
  const CustomerShell({super.key});

  @override
  State<CustomerShell> createState() => _CustomerShellState();
}

class _CustomerShellState extends State<CustomerShell> {
  int _index = 0;

  static const _tabs = [
    PapersScreen(),
    PickupsScreen(),
    WalletScreen(),
    ShopScreen(),
    ImpactScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(index: _index, children: _tabs),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.newspaper_outlined),
            selectedIcon: Icon(Icons.newspaper),
            label: 'Papers',
          ),
          NavigationDestination(
            icon: Icon(Icons.local_shipping_outlined),
            selectedIcon: Icon(Icons.local_shipping),
            label: 'Pickups',
          ),
          NavigationDestination(
            icon: Icon(Icons.account_balance_wallet_outlined),
            selectedIcon: Icon(Icons.account_balance_wallet),
            label: 'Wallet',
          ),
          NavigationDestination(
            icon: Icon(Icons.storefront_outlined),
            selectedIcon: Icon(Icons.storefront),
            label: 'Shop',
          ),
          NavigationDestination(
            icon: Icon(Icons.eco_outlined),
            selectedIcon: Icon(Icons.eco),
            label: 'Impact',
          ),
        ],
      ),
    );
  }
}
