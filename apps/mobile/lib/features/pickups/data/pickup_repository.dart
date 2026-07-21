import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/network/api_failure.dart';
import '../../../core/network/rest_client.dart';
import 'pickup_dtos.dart';

part 'pickup_repository.g.dart';

abstract interface class PickupRepository {
  Future<(List<PickupDto>?, ApiFailure?)> fetchPickups();
  Future<(PickupDto?, ApiFailure?)> fetchPickup(String id);
  Future<(PickupDto?, ApiFailure?)> requestPickup(RequestPickup request);
  Future<ApiFailure?> cancelPickup(String id);
}

class PickupRepositoryImpl implements PickupRepository {
  PickupRepositoryImpl(this._client);
  final RestClient _client;

  @override
  Future<(List<PickupDto>?, ApiFailure?)> fetchPickups() =>
      _client.getList('/pickups', PickupDto.fromJson);

  @override
  Future<(PickupDto?, ApiFailure?)> fetchPickup(String id) =>
      _client.getObject('/pickups/$id', PickupDto.fromJson);

  @override
  Future<(PickupDto?, ApiFailure?)> requestPickup(RequestPickup request) =>
      _client.send('/pickups', PickupDto.fromJson, body: request.toJson());

  @override
  Future<ApiFailure?> cancelPickup(String id) => _client.sendNoContent('/pickups/$id/cancel');
}

@riverpod
PickupRepository pickupRepository(Ref ref) => PickupRepositoryImpl(ref.watch(restClientProvider));

@riverpod
Future<List<PickupDto>> pickups(Ref ref) async {
  final (list, failure) = await ref.watch(pickupRepositoryProvider).fetchPickups();
  if (failure != null) throw failure;
  return list!;
}

@riverpod
Future<PickupDto> pickup(Ref ref, String id) async {
  final (item, failure) = await ref.watch(pickupRepositoryProvider).fetchPickup(id);
  if (failure != null) throw failure;
  return item!;
}
