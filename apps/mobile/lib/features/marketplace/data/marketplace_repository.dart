import 'dart:convert';

import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/network/api_failure.dart';
import '../../../core/network/rest_client.dart';
import 'marketplace_dtos.dart';

part 'marketplace_repository.g.dart';

abstract interface class MarketplaceRepository {
  Future<(List<ProductDto>?, ApiFailure?)> browseProducts();
  Future<(CartDto?, ApiFailure?)> fetchCart();
  Future<(CartDto?, ApiFailure?)> addToCart(String variantId, int quantity);
  Future<(CartDto?, ApiFailure?)> setQuantity(String variantId, int quantity);
  Future<(CheckoutResultDto?, ApiFailure?)> checkout({
    required int requestedWalletPaise,
    String? shippingAddressId,
  });
  Future<(List<OrderDto>?, ApiFailure?)> fetchOrders();
}

class MarketplaceRepositoryImpl implements MarketplaceRepository {
  MarketplaceRepositoryImpl(this._client);
  final RestClient _client;

  @override
  Future<(List<ProductDto>?, ApiFailure?)> browseProducts() =>
      _client.getList('/marketplace/products', ProductDto.fromJson);

  @override
  Future<(CartDto?, ApiFailure?)> fetchCart() =>
      _client.getObject('/marketplace/cart', CartDto.fromJson);

  @override
  Future<(CartDto?, ApiFailure?)> addToCart(String variantId, int quantity) => _client.send(
    '/marketplace/cart/items',
    CartDto.fromJson,
    body: {'variantId': variantId, 'quantity': quantity},
  );

  @override
  Future<(CartDto?, ApiFailure?)> setQuantity(String variantId, int quantity) => _client.send(
    '/marketplace/cart/items/$variantId',
    CartDto.fromJson,
    method: 'PUT',
    body: {'quantity': quantity},
  );

  @override
  Future<(CheckoutResultDto?, ApiFailure?)> checkout({
    required int requestedWalletPaise,
    String? shippingAddressId,
  }) {
    // Checkout moves money and creates an order — the API requires an Idempotency-Key so a
    // double-tap does not create two orders.
    final key = base64Url.encode(utf8.encode('checkout-${DateTime.now().microsecondsSinceEpoch}'));
    return _client.send(
      '/marketplace/checkout',
      CheckoutResultDto.fromJson,
      body: {'requestedWalletPaise': requestedWalletPaise, 'shippingAddressId': ?shippingAddressId},
      headers: {'Idempotency-Key': key},
    );
  }

  @override
  Future<(List<OrderDto>?, ApiFailure?)> fetchOrders() =>
      _client.getList('/marketplace/orders', OrderDto.fromJson);
}

@riverpod
MarketplaceRepository marketplaceRepository(Ref ref) =>
    MarketplaceRepositoryImpl(ref.watch(restClientProvider));

@riverpod
Future<List<ProductDto>> products(Ref ref) async {
  final (list, failure) = await ref.watch(marketplaceRepositoryProvider).browseProducts();
  if (failure != null) throw failure;
  return list!;
}

@riverpod
Future<CartDto> cart(Ref ref) async {
  final (c, failure) = await ref.watch(marketplaceRepositoryProvider).fetchCart();
  if (failure != null) throw failure;
  return c!;
}

@riverpod
Future<List<OrderDto>> orders(Ref ref) async {
  final (list, failure) = await ref.watch(marketplaceRepositoryProvider).fetchOrders();
  if (failure != null) throw failure;
  return list!;
}
