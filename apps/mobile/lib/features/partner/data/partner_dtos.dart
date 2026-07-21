import 'package:freezed_annotation/freezed_annotation.dart';

import '../../pickups/data/pickup_dtos.dart';

part 'partner_dtos.freezed.dart';
part 'partner_dtos.g.dart';

@freezed
sealed class StopDto with _$StopDto {
  const factory StopDto({
    required String id,
    required String subscriptionId,
    required String addressId,
    required String status,
    required int sequence,
    String? reason,
    String? completedAt,
    String? photoUrl,
  }) = _StopDto;

  factory StopDto.fromJson(Map<String, dynamic> json) => _$StopDtoFromJson(json);
}

@freezed
sealed class RunDto with _$RunDto {
  const factory RunDto({
    required String id,
    required String runDate,
    required String zoneId,
    required String status,
    @Default(<StopDto>[]) List<StopDto> stops,
  }) = _RunDto;

  factory RunDto.fromJson(Map<String, dynamic> json) => _$RunDtoFromJson(json);
}

@freezed
sealed class QuoteDto with _$QuoteDto {
  const factory QuoteDto({
    @Default(<PickupItemDto>[]) List<PickupItemDto> lines,
    required int totalWeightGrams,
    required String totalRupees,
  }) = _QuoteDto;

  factory QuoteDto.fromJson(Map<String, dynamic> json) => _$QuoteDtoFromJson(json);
}

@freezed
sealed class CashbackResultDto with _$CashbackResultDto {
  const factory CashbackResultDto({
    required String pickupId,
    required String totalWeightKg,
    required String totalRupees,
    @Default(<PickupItemDto>[]) List<PickupItemDto> lines,
  }) = _CashbackResultDto;

  factory CashbackResultDto.fromJson(Map<String, dynamic> json) =>
      _$CashbackResultDtoFromJson(json);
}

/// One weighed paper type. Whole grams, as the digital-scale / manual-entry reader produces.
class WeightEntry {
  const WeightEntry({required this.paperType, required this.weightGrams});
  final String paperType;
  final int weightGrams;

  Map<String, dynamic> toJson() => {'paperType': paperType, 'weightGrams': weightGrams};
}

/// The paper types the manual weighing reader accepts, with labels for the entry UI.
const paperTypes = <String, String>{
  'NEWSPAPER': 'Newspaper',
  'MAGAZINE': 'Magazine',
  'OFFICE_PAPER': 'Office paper',
  'CARDBOARD': 'Cardboard',
  'OTHER': 'Other',
};

const stopOutcomes = <String, String>{
  'DELIVERED': 'Delivered',
  'FAILED': 'Failed',
  'SKIPPED': 'Skipped',
};
