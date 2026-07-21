import 'package:cpe_mobile/core/network/api_failure.dart';
import 'package:cpe_mobile/features/addresses/data/address_dtos.dart';
import 'package:cpe_mobile/features/addresses/data/address_repository.dart';
import 'package:cpe_mobile/features/newspapers/data/catalog_dtos.dart';
import 'package:cpe_mobile/features/newspapers/data/catalog_repository.dart';
import 'package:cpe_mobile/features/newspapers/presentation/subscribe_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeAddressRepo implements AddressRepository {
  _FakeAddressRepo(this.addresses);
  final List<AddressDto> addresses;
  @override
  Future<(List<AddressDto>?, ApiFailure?)> fetchAddresses() async => (addresses, null);
  @override
  Future<(AddressDto?, ApiFailure?)> createAddress(CreateAddress address) async => (null, null);
}

class _FakeCatalogRepo implements CatalogRepository {
  CreateSubscription? captured;

  @override
  Future<(SubscriptionDto?, ApiFailure?)> createSubscription(CreateSubscription request) async {
    captured = request;
    return (
      SubscriptionDto(
        id: 's1',
        editionId: request.editionId,
        deliveryAddressId: request.deliveryAddressId,
        status: 'ACTIVE',
        frequency: request.frequency,
        billingCycle: request.billingCycle,
        startDate: '2026-07-20',
        pricePerIssueRupees: '₹8.00',
      ),
      null,
    );
  }

  @override
  Future<(List<EditionDto>?, ApiFailure?)> browseEditions({String? pincode}) async =>
      (const <EditionDto>[], null);
  @override
  Future<(List<SubscriptionDto>?, ApiFailure?)> fetchSubscriptions() async =>
      (const <SubscriptionDto>[], null);
  @override
  Future<ApiFailure?> pause(String id) async => null;
  @override
  Future<ApiFailure?> resume(String id) async => null;
  @override
  Future<ApiFailure?> cancel(String id) async => null;
  @override
  Future<ApiFailure?> changeAddress(String id, String addressId) async => null;
}

const _edition = EditionDto(
  id: 'ed-1',
  city: 'Bengaluru',
  state: 'KA',
  pricePerIssueRupees: '₹8.00',
  pricePerIssuePaise: 800,
  isAvailable: true,
  newspaper: NewspaperDto(
    id: 'np-1',
    name: 'The Daily Leaf',
    language: 'ENGLISH',
    publisherName: 'Leaf Media',
  ),
);

const _address = AddressDto(
  id: 'addr-1',
  line1: '12 Green St',
  city: 'Bengaluru',
  state: 'KA',
  pincode: '560001',
  country: 'IN',
  isDefault: true,
);

void main() {
  testWidgets('subscribes to an edition with the chosen options and default address', (
    tester,
  ) async {
    final catalog = _FakeCatalogRepo();

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          addressRepositoryProvider.overrideWithValue(_FakeAddressRepo([_address])),
          catalogRepositoryProvider.overrideWithValue(catalog),
        ],
        child: const MaterialApp(home: SubscribeScreen(edition: _edition)),
      ),
    );
    await tester.pumpAndSettle();

    // The edition summary and the address are shown.
    expect(find.text('The Daily Leaf'), findsOneWidget);
    expect(find.textContaining('12 Green St'), findsWidgets);

    // Choose "Weekdays only" instead of the default, then confirm. The confirm button sits below
    // the fold in the test viewport, so scroll it into view first.
    await tester.tap(find.text('Weekdays only'));
    await tester.pumpAndSettle();
    final confirm = find.widgetWithText(FilledButton, 'Confirm subscription');
    await tester.ensureVisible(confirm);
    await tester.pumpAndSettle();
    await tester.tap(confirm);
    await tester.pumpAndSettle();

    expect(catalog.captured, isNotNull);
    expect(catalog.captured!.editionId, 'ed-1');
    expect(catalog.captured!.deliveryAddressId, 'addr-1');
    expect(catalog.captured!.frequency, 'WEEKDAYS');
    expect(catalog.captured!.billingCycle, 'MONTHLY');
  });
}
