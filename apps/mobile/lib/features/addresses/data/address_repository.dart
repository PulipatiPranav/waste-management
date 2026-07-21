import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/network/api_failure.dart';
import '../../../core/network/rest_client.dart';
import 'address_dtos.dart';

part 'address_repository.g.dart';

abstract interface class AddressRepository {
  Future<(List<AddressDto>?, ApiFailure?)> fetchAddresses();
  Future<(AddressDto?, ApiFailure?)> createAddress(CreateAddress address);
}

class AddressRepositoryImpl implements AddressRepository {
  AddressRepositoryImpl(this._client);
  final RestClient _client;

  @override
  Future<(List<AddressDto>?, ApiFailure?)> fetchAddresses() =>
      _client.getList('/addresses', AddressDto.fromJson);

  @override
  Future<(AddressDto?, ApiFailure?)> createAddress(CreateAddress address) =>
      _client.send('/addresses', AddressDto.fromJson, body: address.toJson());
}

@riverpod
AddressRepository addressRepository(Ref ref) =>
    AddressRepositoryImpl(ref.watch(restClientProvider));

@riverpod
Future<List<AddressDto>> addresses(Ref ref) async {
  final (list, failure) = await ref.watch(addressRepositoryProvider).fetchAddresses();
  if (failure != null) throw failure;
  return list!;
}
