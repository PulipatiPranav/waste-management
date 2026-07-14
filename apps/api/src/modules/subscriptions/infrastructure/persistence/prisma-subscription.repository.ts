import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';

import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';
import { Subscription } from '../../domain/entities/subscription';
import {
  type CreateSubscriptionInput,
  type SubscriptionRepository,
} from '../../domain/ports/subscription.repository';
import { type SubscriptionStatus } from '../../domain/subscription-state-machine';
import { Day } from '../../domain/value-objects/day';

const withPauses = {
  pauses: { orderBy: { pausedFrom: 'asc' } },
} satisfies Prisma.SubscriptionInclude;

type SubscriptionRow = Prisma.SubscriptionGetPayload<{ include: typeof withPauses }>;

@Injectable()
export class PrismaSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateSubscriptionInput): Promise<Subscription> {
    const row = await this.prisma.subscription.create({
      data: {
        userId: input.userId,
        editionId: input.editionId,
        deliveryAddressId: input.deliveryAddressId,
        frequency: input.frequency,
        billingCycle: input.billingCycle,
        startDate: input.startDate.toUtcDate(),
        pricePerIssuePaiseAtSubscription: input.pricePerIssuePaiseAtSubscription,
      },
      include: withPauses,
    });

    return this.toDomain(row);
  }

  async findById(id: string): Promise<Subscription | null> {
    const row = await this.prisma.subscription.findUnique({ where: { id }, include: withPauses });
    return row === null ? null : this.toDomain(row);
  }

  async listForUser(userId: string): Promise<Subscription[]> {
    const rows = await this.prisma.subscription.findMany({
      where: { userId },
      include: withPauses,
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => this.toDomain(row));
  }

  async findLiveForUserAndEdition(userId: string, editionId: string): Promise<Subscription | null> {
    const row = await this.prisma.subscription.findFirst({
      // CANCELLED is excluded: a customer who cancelled must be free to subscribe again.
      where: { userId, editionId, status: { in: ['ACTIVE', 'PAUSED'] } },
      include: withPauses,
    });

    return row === null ? null : this.toDomain(row);
  }

  /**
   * Status change + pause window in ONE transaction.
   *
   * If these were two writes and the second failed, the subscription would be PAUSED
   * with no window — and since billing counts windows, not status, the customer would
   * be charged in full for a month they explicitly paused.
   */
  async pause(id: string, status: SubscriptionStatus, pausedFrom: Day): Promise<Subscription> {
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({ where: { id }, data: { status } });

      await tx.subscriptionPause.create({
        data: { subscriptionId: id, pausedFrom: pausedFrom.toUtcDate() },
      });

      return tx.subscription.findUniqueOrThrow({ where: { id }, include: withPauses });
    });

    return this.toDomain(row);
  }

  async resume(id: string, status: SubscriptionStatus, resumedFrom: Day): Promise<Subscription> {
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({ where: { id }, data: { status } });

      // Closes the one open window. The partial unique index guarantees there is at
      // most one, so `updateMany` here touches exactly zero or one row.
      await tx.subscriptionPause.updateMany({
        where: { subscriptionId: id, resumedFrom: null },
        data: { resumedFrom: resumedFrom.toUtcDate() },
      });

      return tx.subscription.findUniqueOrThrow({ where: { id }, include: withPauses });
    });

    return this.toDomain(row);
  }

  async cancel(id: string, status: SubscriptionStatus, cancelledOn: Day): Promise<Subscription> {
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id },
        data: { status, cancelledAt: cancelledOn.toUtcDate() },
      });

      // Close any open pause at the cancellation date. An open window left dangling
      // would keep accruing credit against a subscription that no longer exists — and
      // `resumedFrom = cancelledOn + 1 day` is the correct close, because the last
      // paused day is the cancellation day itself.
      await tx.subscriptionPause.updateMany({
        where: { subscriptionId: id, resumedFrom: null },
        data: { resumedFrom: cancelledOn.addDays(1).toUtcDate() },
      });

      return tx.subscription.findUniqueOrThrow({ where: { id }, include: withPauses });
    });

    return this.toDomain(row);
  }

  async changeAddress(id: string, deliveryAddressId: string): Promise<Subscription> {
    const row = await this.prisma.subscription.update({
      where: { id },
      data: { deliveryAddressId },
      include: withPauses,
    });

    return this.toDomain(row);
  }

  private toDomain(row: SubscriptionRow): Subscription {
    return Subscription.fromPersistence({
      id: row.id,
      userId: row.userId,
      editionId: row.editionId,
      deliveryAddressId: row.deliveryAddressId,
      status: row.status,
      frequency: row.frequency,
      billingCycle: row.billingCycle,
      startDate: Day.fromUtcDate(row.startDate),
      cancelledOn: row.cancelledAt === null ? null : Day.fromUtcDate(row.cancelledAt),
      pricePerIssuePaiseAtSubscription: row.pricePerIssuePaiseAtSubscription,
      pauses: row.pauses.map((pause) => ({
        pausedFrom: Day.fromUtcDate(pause.pausedFrom),
        resumedFrom: pause.resumedFrom === null ? null : Day.fromUtcDate(pause.resumedFrom),
      })),
      createdAt: row.createdAt,
    });
  }
}
