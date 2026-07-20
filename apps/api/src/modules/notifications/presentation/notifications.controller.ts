import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '@/modules/auth/presentation/decorators/current-user.decorator';
import { Roles } from '@/modules/auth/presentation/decorators/roles.decorator';
import { NotificationUseCases } from '../application/notification.use-cases';
import { type NotificationRecord } from '../domain/ports/notification.repository';
import {
  DeviceTokenDto,
  NotificationDto,
  PreferenceDto,
  RegisterDeviceDto,
  SetPreferenceDto,
  UnregisterDeviceDto,
} from './dto/notification.dto';

const toNotificationDto = (row: NotificationRecord): NotificationDto => ({
  id: row.id,
  category: row.category,
  title: row.title,
  body: row.body,
  data: row.data,
  status: row.status,
  attempts: row.attempts,
  lastError: row.lastError,
  sentAt: row.sentAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

/**
 * A customer's own push settings: register/forget a device, and opt out of categories they do not
 * want. Everything here is scoped to the caller — the user id comes from the token, never a param.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly notifications: NotificationUseCases) {}

  @Post('devices')
  @ApiOperation({
    summary: 'Register this device for push',
    description: 'Idempotent: re-registering the same token refreshes it rather than duplicating.',
  })
  @ApiOkResponse({ type: DeviceTokenDto })
  async registerDevice(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: RegisterDeviceDto,
  ): Promise<DeviceTokenDto> {
    return this.notifications.registerDevice({
      userId: current.id,
      token: dto.token,
      platform: dto.platform,
    });
  }

  @Post('devices/unregister')
  @ApiOperation({ summary: 'Forget a device (sign-out on that device)' })
  @ApiOkResponse()
  async unregisterDevice(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: UnregisterDeviceDto,
  ): Promise<{ ok: true }> {
    await this.notifications.unregisterDevice(current.id, dto.token);
    return { ok: true };
  }

  @Get('preferences')
  @ApiOperation({ summary: 'My notification preferences (every category, on unless opted out)' })
  @ApiOkResponse({ type: [PreferenceDto] })
  getPreferences(@CurrentUser() current: AuthenticatedUser): Promise<PreferenceDto[]> {
    return this.notifications.getPreferences(current.id);
  }

  @Post('preferences')
  @ApiOperation({ summary: 'Opt in or out of a category' })
  @ApiOkResponse({ type: [PreferenceDto] })
  async setPreference(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: SetPreferenceDto,
  ): Promise<PreferenceDto[]> {
    await this.notifications.setPreference(current.id, dto.category, dto.enabled);
    return this.notifications.getPreferences(current.id);
  }

  @Get()
  @ApiOperation({ summary: 'My recent notifications' })
  @ApiOkResponse({ type: [NotificationDto] })
  async listMine(@CurrentUser() current: AuthenticatedUser): Promise<NotificationDto[]> {
    const rows = await this.notifications.listMyNotifications(current.id);
    return rows.map(toNotificationDto);
  }
}

/**
 * Ops view of the dead-letter queue: notifications that permanently failed to send. Its existence
 * is the point — a failed push is recorded and inspectable here, never silently dropped.
 */
@ApiTags('admin/notifications')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Requires OPS_STAFF or SUPER_ADMIN.' })
@Roles('OPS_STAFF', 'SUPER_ADMIN')
@Controller({ path: 'admin/notifications', version: '1' })
export class AdminNotificationsController {
  constructor(private readonly notifications: NotificationUseCases) {}

  @Get('dead-letters')
  @ApiOperation({ summary: 'Notifications that permanently failed to send' })
  @ApiOkResponse({ type: [NotificationDto] })
  async deadLetters(@Query('limit') limit?: string): Promise<NotificationDto[]> {
    const rows = await this.notifications.listDeadLetters(
      limit === undefined ? 100 : Number(limit),
    );
    return rows.map(toNotificationDto);
  }
}
