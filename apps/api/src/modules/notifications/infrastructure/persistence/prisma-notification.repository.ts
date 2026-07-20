import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';
import { type DevicePlatform } from '../../domain/device-platform';
import {
  type CategoryPreference,
  type NotificationCategory,
} from '../../domain/notification-category';
import {
  type DeviceTokenRecord,
  type NotificationRecord,
  type NotificationRepository,
  type NotificationStatus,
} from '../../domain/ports/notification.repository';

@Injectable()
export class PrismaNotificationRepository implements NotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  // --- Device tokens --------------------------------------------------------

  async registerToken(input: {
    userId: string;
    token: string;
    platform: DevicePlatform;
  }): Promise<DeviceTokenRecord> {
    // Upsert on the token: a device install is one row. If the same token reappears under a new
    // user (a shared/handed-on device), it moves — the token identifies the install, not the user.
    const row = await this.prisma.deviceToken.upsert({
      where: { token: input.token },
      update: {
        userId: input.userId,
        platform: input.platform,
        isActive: true,
        lastSeenAt: new Date(),
      },
      create: { userId: input.userId, token: input.token, platform: input.platform },
    });
    return {
      id: row.id,
      userId: row.userId,
      token: row.token,
      platform: row.platform,
      isActive: row.isActive,
    };
  }

  async deactivateOwnedToken(userId: string, token: string): Promise<void> {
    await this.prisma.deviceToken.updateMany({
      where: { userId, token },
      data: { isActive: false },
    });
  }

  async deactivateTokens(tokens: readonly string[]): Promise<void> {
    if (tokens.length === 0) return;
    await this.prisma.deviceToken.updateMany({
      where: { token: { in: [...tokens] } },
      data: { isActive: false },
    });
  }

  async listActiveTargets(userId: string): Promise<{ token: string; platform: DevicePlatform }[]> {
    const rows = await this.prisma.deviceToken.findMany({
      where: { userId, isActive: true },
      select: { token: true, platform: true },
    });
    return rows.map((row) => ({ token: row.token, platform: row.platform }));
  }

  // --- Preferences ----------------------------------------------------------

  async getPreferences(userId: string): Promise<CategoryPreference[]> {
    const rows = await this.prisma.notificationPreference.findMany({ where: { userId } });
    return rows.map((row) => ({ category: row.category, enabled: row.enabled }));
  }

  async setPreference(
    userId: string,
    category: NotificationCategory,
    enabled: boolean,
  ): Promise<void> {
    await this.prisma.notificationPreference.upsert({
      where: { userId_category: { userId, category } },
      update: { enabled },
      create: { userId, category, enabled },
    });
  }

  // --- Notification log / dead-letter --------------------------------------

  async createQueued(input: {
    userId: string;
    category: NotificationCategory;
    title: string;
    body: string;
    data: Record<string, string> | null;
  }): Promise<NotificationRecord> {
    const row = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        category: input.category,
        title: input.title,
        body: input.body,
        data: input.data ?? Prisma.JsonNull,
        status: 'QUEUED',
      },
    });
    return this.toRecord(row);
  }

  async markSent(id: string, attempts: number): Promise<void> {
    await this.prisma.notification.update({
      where: { id },
      data: { status: 'SENT', attempts, sentAt: new Date() },
    });
  }

  async markFailed(id: string, attempts: number, error: string): Promise<void> {
    await this.prisma.notification.update({
      where: { id },
      data: { status: 'FAILED', attempts, lastError: error.slice(0, 500) },
    });
  }

  async findById(id: string): Promise<NotificationRecord | null> {
    const row = await this.prisma.notification.findUnique({ where: { id } });
    return row === null ? null : this.toRecord(row);
  }

  async listForUser(userId: string, limit: number): Promise<NotificationRecord[]> {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => this.toRecord(row));
  }

  async listDeadLetters(limit: number): Promise<NotificationRecord[]> {
    const rows = await this.prisma.notification.findMany({
      where: { status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => this.toRecord(row));
  }

  private toRecord(row: {
    id: string;
    userId: string;
    category: NotificationCategory;
    title: string;
    body: string;
    data: Prisma.JsonValue;
    status: string;
    attempts: number;
    lastError: string | null;
    sentAt: Date | null;
    createdAt: Date;
  }): NotificationRecord {
    return {
      id: row.id,
      userId: row.userId,
      category: row.category,
      title: row.title,
      body: row.body,
      data: (row.data as Record<string, string> | null) ?? null,
      status: row.status as NotificationStatus,
      attempts: row.attempts,
      lastError: row.lastError,
      sentAt: row.sentAt,
      createdAt: row.createdAt,
    };
  }
}
