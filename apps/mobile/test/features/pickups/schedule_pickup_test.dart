import 'package:cpe_mobile/core/network/api_failure.dart';
import 'package:cpe_mobile/features/addresses/data/address_dtos.dart';
import 'package:cpe_mobile/features/addresses/data/address_repository.dart';
import 'package:cpe_mobile/features/pickups/data/pickup_dtos.dart';
import 'package:cpe_mobile/features/pickups/data/pickup_repository.dart';
import 'package:cpe_mobile/features/pickups/presentation/schedule_pickup_screen.dart';
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

class _FakePickupRepo implements PickupRepository {
  RequestPickup? captured;

  @override
  Future<(PickupDto?, ApiFailure?)> requestPickup(RequestPickup request) async {
    captured = request;
    return (
      PickupDto(
        id: 'p1',
        addressId: request.addressId,
        scheduledDate: request.scheduledDate,
        windowStartHour: request.windowStartHour,
        windowEndHour: request.windowEndHour,
        status: 'REQUESTED',
        totalRupees: '₹0.00',
      ),
      null,
    );
  }

  @override
  Future<(List<PickupDto>?, ApiFailure?)> fetchPickups() async => (const <PickupDto>[], null);
  @override
  Future<(PickupDto?, ApiFailure?)> fetchPickup(String id) async => (null, null);
  @override
  Future<ApiFailure?> cancelPickup(String id) async => null;
}

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
  testWidgets('schedules a pickup at the selected address and default window', (tester) async {
    final pickupRepo = _FakePickupRepo();

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          addressRepositoryProvider.overrideWithValue(_FakeAddressRepo([_address])),
          pickupRepositoryProvider.overrideWithValue(pickupRepo),
        ],
        child: const MaterialApp(home: SchedulePickupScreen()),
      ),
    );
    await tester.pumpAndSettle();

    // The saved address loaded and became the default selection.
    expect(find.textContaining('12 Green St'), findsWidgets);

    await tester.tap(find.widgetWithText(FilledButton, 'Schedule pickup'));
    await tester.pumpAndSettle();

    // The request went out for that address with the default 9–12 window.
    expect(pickupRepo.captured, isNotNull);
    expect(pickupRepo.captured!.addressId, 'addr-1');
    expect(pickupRepo.captured!.windowStartHour, 9);
    expect(pickupRepo.captured!.windowEndHour, 12);
  });

  testWidgets('prompts to add an address when none exist', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          addressRepositoryProvider.overrideWithValue(_FakeAddressRepo(const [])),
          pickupRepositoryProvider.overrideWithValue(_FakePickupRepo()),
        ],
        child: const MaterialApp(home: SchedulePickupScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('No saved addresses'), findsOneWidget);
  });
}
