import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from '@/config/env.schema';
import { AuthModule } from '@/modules/auth/auth.module';
import { NotificationUseCases } from './application/notification.use-cases';
import { NOTIFICATION_DISPATCHER } from './domain/ports/notification-dispatcher.port';
import {
  NOTIFICATION_PROVIDER,
  type NotificationProvider,
} from './domain/ports/notification-provider.port';
import { NOTIFICATION_REPOSITORY } from './domain/ports/notification.repository';
import { REMINDER_QUERY } from './domain/ports/reminder-query.port';
import {
  NOTIFICATIONS_QUEUE,
  NotificationWorker,
  QueueNotificationDispatcher,
} from './infrastructure/jobs/notifications.queue';
import {
  REMINDERS_QUEUE,
  ReminderScheduler,
  ReminderWorker,
} from './infrastructure/jobs/notification-reminders.queue';
import { PrismaNotificationRepository } from './infrastructure/persistence/prisma-notification.repository';
import { PrismaReminderQuery } from './infrastructure/persistence/prisma-reminder.query';
import { ApnsProvider } from './infrastructure/providers/apns.provider';
import { CompositePushProvider } from './infrastructure/providers/composite-push.provider';
import { FakePushProvider } from './infrastructure/providers/fake-push.provider';
import { FcmProvider } from './infrastructure/providers/fcm.provider';
import {
  AdminNotificationsController,
  NotificationsController,
} from './presentation/notifications.controller';

/**
 * Chooses the push backend at boot: the fake in-process provider for dev/tests, or the real
 * composite (FCM for Android, APNs for iOS) in production. Business code only ever sees the
 * NOTIFICATION_PROVIDER token — this factory is the one place the concrete providers are named.
 */
function pushProviderFactory(config: ConfigService<Env, true>): NotificationProvider {
  if (config.get('PUSH_PROVIDER', { infer: true }) !== 'fcm') {
    return new FakePushProvider();
  }

  const serviceAccount = config.get('FCM_SERVICE_ACCOUNT_JSON', { infer: true });
  const fcm = serviceAccount === undefined ? null : new FcmProvider(serviceAccount);

  const keyId = config.get('APNS_KEY_ID', { infer: true });
  const teamId = config.get('APNS_TEAM_ID', { infer: true });
  const bundleId = config.get('APNS_BUNDLE_ID', { infer: true });
  const privateKey = config.get('APNS_PRIVATE_KEY', { infer: true });
  const apns =
    keyId !== undefined &&
    teamId !== undefined &&
    bundleId !== undefined &&
    privateKey !== undefined
      ? new ApnsProvider({ keyId, teamId, bundleId, privateKey })
      : null;

  return new CompositePushProvider(fcm, apns);
}

@Module({
  imports: [
    AuthModule,
    // BullModule.forRoot is registered once by DeliveryModule; registerQueue attaches to it.
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }, { name: REMINDERS_QUEUE }),
  ],
  controllers: [NotificationsController, AdminNotificationsController],
  providers: [
    { provide: NOTIFICATION_REPOSITORY, useClass: PrismaNotificationRepository },
    { provide: REMINDER_QUERY, useClass: PrismaReminderQuery },
    { provide: NOTIFICATION_PROVIDER, inject: [ConfigService], useFactory: pushProviderFactory },
    { provide: NOTIFICATION_DISPATCHER, useClass: QueueNotificationDispatcher },
    NotificationUseCases,
    NotificationWorker,
    ReminderScheduler,
    ReminderWorker,
  ],
  // Every triggering module (pickups, wallet, delivery, marketplace) injects the dispatcher to
  // notify a user — through this port, never the queue directly.
  exports: [NOTIFICATION_DISPATCHER],
})
export class NotificationsModule {}
