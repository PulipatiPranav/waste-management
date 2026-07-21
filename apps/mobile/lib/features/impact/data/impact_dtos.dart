import 'package:freezed_annotation/freezed_annotation.dart';

part 'impact_dtos.freezed.dart';
part 'impact_dtos.g.dart';

/// Every figure here is labelled by the SERVER as measured (recycled/landfill-diverted weight) or
/// ESTIMATED (CO2e, water, energy, trees). The app must preserve that distinction in its copy —
/// see the disclaimer, which is shown verbatim.
@freezed
sealed class ImpactMetricsDto with _$ImpactMetricsDto {
  const factory ImpactMetricsDto({
    required double recycledKg,
    required double landfillDivertedKg,
    required double estimatedCo2eAvoidedKg,
    required double estimatedWaterSavedLitres,
    required double estimatedEnergySavedKwh,
    required double estimatedTreesEquivalent,
  }) = _ImpactMetricsDto;

  factory ImpactMetricsDto.fromJson(Map<String, dynamic> json) => _$ImpactMetricsDtoFromJson(json);
}

@freezed
sealed class ImpactReportDto with _$ImpactReportDto {
  const factory ImpactReportDto({
    required ImpactMetricsDto lifetime,
    required String disclaimer,
    String? computedAt,
  }) = _ImpactReportDto;

  factory ImpactReportDto.fromJson(Map<String, dynamic> json) => _$ImpactReportDtoFromJson(json);
}
