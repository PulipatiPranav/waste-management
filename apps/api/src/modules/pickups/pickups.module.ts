import { forwardRef, Module } from '@nestjs/common';

import { AddressesModule } from '@/modules/addresses/addresses.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { DeliveryModule } from '@/modules/delivery/delivery.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { WalletModule } from '@/modules/wallet/wallet.module';
import { AssignPickupsToRunsUseCase } from './application/assign-pickups.use-case';
import { PickupUseCases } from './application/pickup.use-cases';
import { PICKUP_REPOSITORY } from './domain/ports/pickup.repository';
import { WEIGHING_DEVICE_READER } from './domain/ports/weighing-device.port';
import { PrismaPickupRepository } from './infrastructure/persistence/prisma-pickup.repository';
import { ManualEntryWeighingReader } from './infrastructure/weighing/manual-entry.reader';
import { AdminRatesController } from './presentation/admin-pickups.controller';
import { PartnerPickupsController, PickupsController } from './presentation/pickups.controller';

@Module({
  imports: [
    WalletModule,
    AddressesModule,
    // forwardRef because the dependency is genuinely MUTUAL, not accidental: pickups need
    // the delivery repository (to check a partner owns the pickup, and to find runs), and
    // the nightly delivery job needs the pickup assigner (pickups ride along with the
    // delivery round). Inventing a shared "logistics" module to break the cycle would be a
    // bigger lie about the domain than the cycle is.
    forwardRef(() => DeliveryModule),
    NotificationsModule,
    AuthModule,
  ],
  controllers: [PickupsController, PartnerPickupsController, AdminRatesController],
  providers: [
    { provide: PICKUP_REPOSITORY, useClass: PrismaPickupRepository },
    // The manual-entry scale. A real Bluetooth reader is a new class implementing
    // WeighingDeviceReader and one line here — no use case changes.
    { provide: WEIGHING_DEVICE_READER, useClass: ManualEntryWeighingReader },
    PickupUseCases,
    AssignPickupsToRunsUseCase,
  ],
  exports: [PICKUP_REPOSITORY, AssignPickupsToRunsUseCase],
})
export class PickupsModule {}
