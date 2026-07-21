import 'package:freezed_annotation/freezed_annotation.dart';

part 'catalog_dtos.freezed.dart';
part 'catalog_dtos.g.dart';

@freezed
sealed class NewspaperDto with _$NewspaperDto {
  const factory NewspaperDto({
    required String id,
    required String name,
    required String language,
    required String publisherName,
    String? coverImageUrl,
  }) = _NewspaperDto;

  factory NewspaperDto.fromJson(Map<String, dynamic> json) => _$NewspaperDtoFromJson(json);
}

@freezed
sealed class EditionDto with _$EditionDto {
  const factory EditionDto({
    required String id,
    required String city,
    required String state,
    required String pricePerIssueRupees,
    required int pricePerIssuePaise,
    required bool isAvailable,
    required NewspaperDto newspaper,
  }) = _EditionDto;

  factory EditionDto.fromJson(Map<String, dynamic> json) => _$EditionDtoFromJson(json);
}

@freezed
sealed class SubscriptionDto with _$SubscriptionDto {
  const factory SubscriptionDto({
    required String id,
    required String editionId,
    required String deliveryAddressId,
    required String status,
    required String frequency,
    required String billingCycle,
    required String startDate,
    required String pricePerIssueRupees,
    String? cancelledOn,
  }) = _SubscriptionDto;

  factory SubscriptionDto.fromJson(Map<String, dynamic> json) => _$SubscriptionDtoFromJson(json);
}

class CreateSubscription {
  const CreateSubscription({
    required this.editionId,
    required this.deliveryAddressId,
    required this.frequency,
    required this.billingCycle,
  });

  final String editionId;
  final String deliveryAddressId;
  final String frequency;
  final String billingCycle;

  Map<String, dynamic> toJson() => {
    'editionId': editionId,
    'deliveryAddressId': deliveryAddressId,
    'frequency': frequency,
    'billingCycle': billingCycle,
  };
}

/// The delivery frequencies the API accepts, with labels for the picker.
const deliveryFrequencies = <String, String>{
  'DAILY': 'Every day',
  'WEEKDAYS': 'Weekdays only',
  'WEEKENDS': 'Weekends only',
  'SUNDAY_ONLY': 'Sundays only',
};

const billingCycles = <String, String>{'MONTHLY': 'Monthly', 'QUARTERLY': 'Quarterly'};
