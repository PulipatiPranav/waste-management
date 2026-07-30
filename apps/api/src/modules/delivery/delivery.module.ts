import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from '@/config/env.schema';
import { AuthModule } from '@/modules/auth/auth.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { PickupsModule } from '@/modules/pickups/pickups.module';
import { UsersModule } from '@/modules/users/users.module';
import {
  AdminDeliveryUseCases,
  PartnerDeliveryUseCases,
  PlanDeliveryRunsUseCase,
} from './application/delivery.use-cases';
import { DELIVERY_EVENT_PUBLISHER } from './domain/ports/delivery-events.port';
import { DELIVERY_REPOSITORY } from './domain/ports/delivery.repository';
import { STORAGE_PROVIDER } from './domain/ports/storage-provider.port';
import {
  DELIVERY_PLANNER_QUEUE,
  DeliveryPlannerScheduler,
  DeliveryPlannerWorker,
} from './infrastructure/jobs/delivery-planner.queue';
import { PrismaDeliveryRepository } from './infrastructure/persistence/prisma-delivery.repository';
import { DeliveryGateway } from './infrastructure/realtime/delivery.gateway';
import { LocalStorageProvider } from './infrastructure/storage/local-storage.provider';
import { S3StorageProvider } from './infrastructure/storage/s3-storage.provider';
import { AdminDeliveryController } from './presentation/admin-delivery.controller';
import { PartnerDeliveryController } from './presentation/partner-delivery.controller';

@Module({
  imports: [
    // AuthModule for CLOCK and TOKEN_ISSUER (the gateway authenticates its own
    // handshakes — the HTTP guard never sees a socket). UsersModule for the role
    // lookup, which the gateway repeats from the DB rather than trusting the token.
    AuthModule,
    UsersModule,

    // See the note in PickupsModule: the dependency is genuinely mutual. The nightly job
    // plans delivery runs and then slots pickups into them, because a pickup rides along
    // with the delivery round rather than getting its own dispatch.
    forwardRef(() => PickupsModule),
    NotificationsModule,

    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: {
          host: config.get('REDIS_HOST', { infer: true }),
          port: config.get('REDIS_PORT', { infer: true }),
          ...(config.get('REDIS_PASSWORD', { infer: true }) !== undefined
            ? { password: config.get('REDIS_PASSWORD', { infer: true }) }
            : {}),
        },
      }),
    }),
    BullModule.registerQueue({ name: DELIVERY_PLANNER_QUEUE }),
  ],

  controllers: [PartnerDeliveryController, AdminDeliveryController],

  providers: [
    { provide: DELIVERY_REPOSITORY, useClass: PrismaDeliveryRepository },
    // Picked at boot from STORAGE_PROVIDER. Constructs only the ONE selected class —
    // S3StorageProvider validates its config in the constructor and throws if it isn't
    // set, so it must never be built when 'local' is the active provider.
    {
      provide: STORAGE_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('STORAGE_PROVIDER', { infer: true }) === 's3'
          ? new S3StorageProvider(config)
          : new LocalStorageProvider(config),
    },

    // The gateway IS the event publisher. The use case only ever sees the port, so it
    // has no idea a WebSocket exists — and a dead socket cannot fail a delivery.
    DeliveryGateway,
    { provide: DELIVERY_EVENT_PUBLISHER, useExisting: DeliveryGateway },

    PlanDeliveryRunsUseCase,
    PartnerDeliveryUseCases,
    AdminDeliveryUseCases,

    DeliveryPlannerScheduler,
    DeliveryPlannerWorker,
  ],

  // PickupsModule needs this to check that a pickup belongs to the scanning partner, and
  // to find the run a pickup rides along with. The PORT leaves the module, never the
  // Prisma class.
  exports: [DELIVERY_REPOSITORY],
})
export class DeliveryModule {}
