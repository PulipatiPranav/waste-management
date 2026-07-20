import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';
import {
  type ActiveSubscriptionForReminder,
  type PendingPickupForReminder,
  type ReminderQuery,
} from '../../domain/ports/reminder-query.port';

@Injectable()
export class PrismaReminderQuery implements ReminderQuery {
  constructor(private readonly prisma: PrismaService) {}

  async activeSubscriptions(): Promise<ActiveSubscriptionForReminder[]> {
    const rows = await this.prisma.subscription.findMany({
      where: { status: 'ACTIVE' },
      select: {
        userId: true,
        startDate: true,
        billingCycle: true,
        edition: { select: { newspaper: { select: { name: true } } } },
      },
    });

    return rows.map((row) => ({
      userId: row.userId,
      startDate: row.startDate,
      billingCycle: row.billingCycle,
      editionName: row.edition.newspaper.name,
    }));
  }

  async pendingPickupsOn(date: Date): Promise<PendingPickupForReminder[]> {
    const rows = await this.prisma.pickupRequest.findMany({
      where: {
        scheduledDate: date,
        status: { in: ['REQUESTED', 'ASSIGNED'] },
      },
      select: { userId: true, scheduledDate: true },
    });

    return rows.map((row) => ({ userId: row.userId, scheduledDate: row.scheduledDate }));
  }
}
