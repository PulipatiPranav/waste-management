import 'package:freezed_annotation/freezed_annotation.dart';

part 'address_dtos.freezed.dart';
part 'address_dtos.g.dart';

@freezed
sealed class AddressDto with _$AddressDto {
  const AddressDto._();

  const factory AddressDto({
    required String id,
    required String line1,
    required String city,
    required String state,
    required String pincode,
    required String country,
    required bool isDefault,
    String? label,
    String? line2,
    String? landmark,
  }) = _AddressDto;

  factory AddressDto.fromJson(Map<String, dynamic> json) => _$AddressDtoFromJson(json);

  /// A one-line rendering for pickers and summaries.
  String get summary => [
    label,
    line1,
    line2,
    '$city $pincode',
  ].whereType<String>().where((s) => s.isNotEmpty).join(', ');
}

class CreateAddress {
  const CreateAddress({
    required this.line1,
    required this.city,
    required this.state,
    required this.pincode,
    this.label,
    this.line2,
    this.landmark,
    this.isDefault = false,
  });

  final String line1;
  final String city;
  final String state;
  final String pincode;
  final String? label;
  final String? line2;
  final String? landmark;
  final bool isDefault;

  Map<String, dynamic> toJson() => {
    'line1': line1,
    'city': city,
    'state': state,
    'pincode': pincode,
    if (label != null && label!.isNotEmpty) 'label': label,
    if (line2 != null && line2!.isNotEmpty) 'line2': line2,
    if (landmark != null && landmark!.isNotEmpty) 'landmark': landmark,
    'isDefault': isDefault,
  };
}
