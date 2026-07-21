import 'package:freezed_annotation/freezed_annotation.dart';

part 'marketplace_dtos.freezed.dart';
part 'marketplace_dtos.g.dart';

@freezed
sealed class VariantDto with _$VariantDto {
  const factory VariantDto({
    required String id,
    required String sku,
    required String name,
    required int pricePaise,
    required String priceRupees,
    required int stock,
    required bool isActive,
  }) = _VariantDto;

  factory VariantDto.fromJson(Map<String, dynamic> json) => _$VariantDtoFromJson(json);
}

@freezed
sealed class ProductDto with _$ProductDto {
  const factory ProductDto({
    required String id,
    required String sellerName,
    required String name,
    required String slug,
    @Default(<VariantDto>[]) List<VariantDto> variants,
    String? recycledContent,
  }) = _ProductDto;

  factory ProductDto.fromJson(Map<String, dynamic> json) => _$ProductDtoFromJson(json);
}

@freezed
sealed class CartLineDto with _$CartLineDto {
  const factory CartLineDto({
    required String variantId,
    required String productName,
    required String variantName,
    required int quantity,
    required String lineTotalRupees,
    required int availableStock,
  }) = _CartLineDto;

  factory CartLineDto.fromJson(Map<String, dynamic> json) => _$CartLineDtoFromJson(json);
}

@freezed
sealed class CartDto with _$CartDto {
  const factory CartDto({
    @Default(<CartLineDto>[]) List<CartLineDto> lines,
    required int subtotalPaise,
    required String subtotalRupees,
  }) = _CartDto;

  factory CartDto.fromJson(Map<String, dynamic> json) => _$CartDtoFromJson(json);
}

@freezed
sealed class OrderItemDto with _$OrderItemDto {
  const factory OrderItemDto({
    required String productName,
    required String variantName,
    required int quantity,
  }) = _OrderItemDto;

  factory OrderItemDto.fromJson(Map<String, dynamic> json) => _$OrderItemDtoFromJson(json);
}

@freezed
sealed class OrderDto with _$OrderDto {
  const factory OrderDto({
    required String id,
    required String status,
    required String totalRupees,
    required int walletAppliedPaise,
    required int gatewayAmountPaise,
    @Default(<OrderItemDto>[]) List<OrderItemDto> items,
    String? failureReason,
    required String createdAt,
  }) = _OrderDto;

  factory OrderDto.fromJson(Map<String, dynamic> json) => _$OrderDtoFromJson(json);
}

@freezed
sealed class GatewayHandoffDto with _$GatewayHandoffDto {
  const factory GatewayHandoffDto({
    required String provider,
    required String gatewayOrderId,
    required int amountPaise,
  }) = _GatewayHandoffDto;

  factory GatewayHandoffDto.fromJson(Map<String, dynamic> json) =>
      _$GatewayHandoffDtoFromJson(json);
}

@freezed
sealed class CheckoutResultDto with _$CheckoutResultDto {
  const factory CheckoutResultDto({required OrderDto order, GatewayHandoffDto? gateway}) =
      _CheckoutResultDto;

  factory CheckoutResultDto.fromJson(Map<String, dynamic> json) =>
      _$CheckoutResultDtoFromJson(json);
}
