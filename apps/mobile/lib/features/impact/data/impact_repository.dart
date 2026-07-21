import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/network/api_failure.dart';
import '../../../core/network/rest_client.dart';
import 'impact_dtos.dart';

part 'impact_repository.g.dart';

abstract interface class ImpactRepository {
  Future<(ImpactReportDto?, ApiFailure?)> fetchMyImpact();
}

class ImpactRepositoryImpl implements ImpactRepository {
  ImpactRepositoryImpl(this._client);
  final RestClient _client;

  @override
  Future<(ImpactReportDto?, ApiFailure?)> fetchMyImpact() =>
      _client.getObject('/impact/me', ImpactReportDto.fromJson);
}

@riverpod
ImpactRepository impactRepository(Ref ref) => ImpactRepositoryImpl(ref.watch(restClientProvider));

@riverpod
Future<ImpactReportDto> myImpact(Ref ref) async {
  final (report, failure) = await ref.watch(impactRepositoryProvider).fetchMyImpact();
  if (failure != null) throw failure;
  return report!;
}
