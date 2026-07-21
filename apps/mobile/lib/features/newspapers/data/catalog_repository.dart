import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/network/api_failure.dart';
import '../../../core/network/rest_client.dart';
import 'catalog_dtos.dart';

part 'catalog_repository.g.dart';

abstract interface class CatalogRepository {
  Future<(List<EditionDto>?, ApiFailure?)> browseEditions({String? pincode});
  Future<(List<SubscriptionDto>?, ApiFailure?)> fetchSubscriptions();
  Future<(SubscriptionDto?, ApiFailure?)> createSubscription(CreateSubscription request);
  Future<ApiFailure?> pause(String id);
  Future<ApiFailure?> resume(String id);
  Future<ApiFailure?> cancel(String id);
  Future<ApiFailure?> changeAddress(String id, String addressId);
}

class CatalogRepositoryImpl implements CatalogRepository {
  CatalogRepositoryImpl(this._client);
  final RestClient _client;

  @override
  Future<(List<EditionDto>?, ApiFailure?)> browseEditions({String? pincode}) {
    return _client.getList(
      '/catalog/editions',
      EditionDto.fromJson,
      query: pincode != null && pincode.isNotEmpty ? {'pincode': pincode} : null,
    );
  }

  @override
  Future<(List<SubscriptionDto>?, ApiFailure?)> fetchSubscriptions() =>
      _client.getList('/subscriptions', SubscriptionDto.fromJson);

  @override
  Future<(SubscriptionDto?, ApiFailure?)> createSubscription(CreateSubscription request) =>
      _client.send('/subscriptions', SubscriptionDto.fromJson, body: request.toJson());

  @override
  Future<ApiFailure?> pause(String id) => _client.sendNoContent('/subscriptions/$id/pause');

  @override
  Future<ApiFailure?> resume(String id) => _client.sendNoContent('/subscriptions/$id/resume');

  @override
  Future<ApiFailure?> cancel(String id) => _client.sendNoContent('/subscriptions/$id/cancel');

  @override
  Future<ApiFailure?> changeAddress(String id, String addressId) => _client.sendNoContent(
    '/subscriptions/$id/change-address',
    body: {'deliveryAddressId': addressId},
  );
}

@riverpod
CatalogRepository catalogRepository(Ref ref) =>
    CatalogRepositoryImpl(ref.watch(restClientProvider));

@riverpod
Future<List<EditionDto>> editions(Ref ref, {String? pincode}) async {
  final (list, failure) = await ref
      .watch(catalogRepositoryProvider)
      .browseEditions(pincode: pincode);
  if (failure != null) throw failure;
  return list!;
}

@riverpod
Future<List<SubscriptionDto>> subscriptions(Ref ref) async {
  final (list, failure) = await ref.watch(catalogRepositoryProvider).fetchSubscriptions();
  if (failure != null) throw failure;
  return list!;
}
