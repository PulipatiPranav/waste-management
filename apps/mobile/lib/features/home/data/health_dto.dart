import 'package:freezed_annotation/freezed_annotation.dart';

part 'health_dto.freezed.dart';
part 'health_dto.g.dart';

/// Wire format of `GET /health/live`.
///
/// DTOs live in `data/` and never leak past it: the repository maps them to domain
/// entities. That boundary is what stops a rename in a JSON payload from rippling
/// through every widget in the app.
///
/// Mirrors `HealthCheckResponse` in packages/shared-types. Once the API publishes
/// its OpenAPI spec, this file becomes generated rather than hand-written.
@freezed
abstract class HealthDto with _$HealthDto {
  const factory HealthDto({
    required String status,
    required int uptimeSeconds,
    required String version,
    required String timestamp,
  }) = _HealthDto;

  factory HealthDto.fromJson(Map<String, dynamic> json) => _$HealthDtoFromJson(json);
}
