import 'package:freezed_annotation/freezed_annotation.dart';

part 'pickup_dtos.freezed.dart';
part 'pickup_dtos.g.dart';

@freezed
sealed class PickupItemDto with _$PickupItemDto {
  const factory PickupItemDto({
    required String paperType,
    required int weightGrams,
    required String weightKg,
    required String amountRupees,
  }) = _PickupItemDto;

  factory PickupItemDto.fromJson(Map<String, dynamic> json) => _$PickupItemDtoFromJson(json);
}

@freezed
sealed class PickupDto with _$PickupDto {
  const factory PickupDto({
    required String id,
    required String addressId,
    required String scheduledDate,
    required int windowStartHour,
    required int windowEndHour,
    required String status,
    required String totalRupees,
    @Default(<PickupItemDto>[]) List<PickupItemDto> items,
    String? qrToken,
    String? completedAt,
  }) = _PickupDto;

  factory PickupDto.fromJson(Map<String, dynamic> json) => _$PickupDtoFromJson(json);
}

class RequestPickup {
  const RequestPickup({
    required this.addressId,
    required this.scheduledDate,
    required this.windowStartHour,
    required this.windowEndHour,
  });

  final String addressId;

  /// YYYY-MM-DD (the API stores a date, not an instant).
  final String scheduledDate;
  final int windowStartHour;
  final int windowEndHour;

  Map<String, dynamic> toJson() => {
    'addressId': addressId,
    'scheduledDate': scheduledDate,
    'windowStartHour': windowStartHour,
    'windowEndHour': windowEndHour,
  };
}
