import 'package:dio/dio.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/network/api_failure.dart';
import '../../../core/network/dio_client.dart';
import '../../../core/network/rest_client.dart';
import '../../pickups/data/pickup_dtos.dart';
import 'partner_dtos.dart';

part 'partner_repository.g.dart';

abstract interface class PartnerRepository {
  Future<(List<RunDto>?, ApiFailure?)> fetchMyRuns({String? date});
  Future<(StopDto?, ApiFailure?)> recordOutcome(
    String stopId, {
    required String outcome,
    String? reason,
    String? photoKey,
  });
  Future<(String?, ApiFailure?)> uploadPhoto(String stopId, String filePath);
  Future<(PickupDto?, ApiFailure?)> scanPickup(String qrToken);
  Future<(QuoteDto?, ApiFailure?)> quotePickup(List<WeightEntry> weights);
  Future<(CashbackResultDto?, ApiFailure?)> completePickup(
    String pickupId,
    List<WeightEntry> weights,
  );
}

class PartnerRepositoryImpl implements PartnerRepository {
  PartnerRepositoryImpl(this._client, this._dio);
  final RestClient _client;
  final Dio _dio;

  @override
  Future<(List<RunDto>?, ApiFailure?)> fetchMyRuns({String? date}) => _client.getList(
    '/delivery/my-runs',
    RunDto.fromJson,
    query: date != null ? {'date': date} : null,
  );

  @override
  Future<(StopDto?, ApiFailure?)> recordOutcome(
    String stopId, {
    required String outcome,
    String? reason,
    String? photoKey,
  }) => _client.send(
    '/delivery/stops/$stopId/outcome',
    StopDto.fromJson,
    body: {'outcome': outcome, 'reason': ?reason, 'photoKey': ?photoKey},
  );

  @override
  Future<(String?, ApiFailure?)> uploadPhoto(String stopId, String filePath) async {
    try {
      final form = FormData.fromMap({'photo': await MultipartFile.fromFile(filePath)});
      final res = await _dio.post<dynamic>('/delivery/stops/$stopId/photo', data: form);
      final data = res.data;
      if (res.statusCode == null || res.statusCode! >= 300 || data is! Map) {
        return (null, const ApiFailure.server(message: 'Photo upload failed'));
      }
      return (data['photoKey'] as String?, null);
    } on DioException catch (e) {
      return (null, mapDioError(e));
    }
  }

  @override
  Future<(PickupDto?, ApiFailure?)> scanPickup(String qrToken) =>
      _client.send('/delivery/pickups/scan', PickupDto.fromJson, body: {'qrToken': qrToken});

  @override
  Future<(QuoteDto?, ApiFailure?)> quotePickup(List<WeightEntry> weights) => _client.send(
    '/delivery/pickups/quote',
    QuoteDto.fromJson,
    body: {'weights': weights.map((w) => w.toJson()).toList()},
  );

  @override
  Future<(CashbackResultDto?, ApiFailure?)> completePickup(
    String pickupId,
    List<WeightEntry> weights,
  ) => _client.send(
    '/delivery/pickups/$pickupId/complete',
    CashbackResultDto.fromJson,
    body: {'weights': weights.map((w) => w.toJson()).toList()},
  );
}

@riverpod
PartnerRepository partnerRepository(Ref ref) =>
    PartnerRepositoryImpl(ref.watch(restClientProvider), ref.watch(dioProvider));

@riverpod
Future<List<RunDto>> myRuns(Ref ref, {String? date}) async {
  final (runs, failure) = await ref.watch(partnerRepositoryProvider).fetchMyRuns(date: date);
  if (failure != null) throw failure;
  return runs!;
}
