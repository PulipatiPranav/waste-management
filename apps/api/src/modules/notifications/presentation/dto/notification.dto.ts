import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

import { DEVICE_PLATFORMS } from '../../domain/device-platform';
import { NOTIFICATION_CATEGORIES } from '../../domain/notification-category';

export class RegisterDeviceDto {
  @ApiProperty({ description: 'FCM registration token / APNs device token' })
  @IsString()
  @MinLength(8)
  @MaxLength(4096)
  token!: string;

  @ApiProperty({ enum: DEVICE_PLATFORMS })
  @IsEnum(DEVICE_PLATFORMS)
  platform!: (typeof DEVICE_PLATFORMS)[number];
}

export class UnregisterDeviceDto {
  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(4096)
  token!: string;
}

export class SetPreferenceDto {
  @ApiProperty({ enum: NOTIFICATION_CATEGORIES })
  @IsEnum(NOTIFICATION_CATEGORIES)
  category!: (typeof NOTIFICATION_CATEGORIES)[number];

  @ApiProperty({ description: 'false = opt out of this category' })
  @IsBoolean()
  enabled!: boolean;
}

export class DeviceTokenDto {
  @ApiProperty() token!: string;
  @ApiProperty({ enum: DEVICE_PLATFORMS }) platform!: string;
}

export class PreferenceDto {
  @ApiProperty({ enum: NOTIFICATION_CATEGORIES }) category!: string;
  @ApiProperty() label!: string;
  @ApiProperty() enabled!: boolean;
}

export class NotificationDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: NOTIFICATION_CATEGORIES }) category!: string;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ nullable: true, type: Object }) data!: Record<string, string> | null;
  @ApiProperty({ enum: ['QUEUED', 'SENT', 'FAILED'] }) status!: string;
  @ApiProperty() attempts!: number;
  @ApiProperty({ nullable: true, type: String }) lastError!: string | null;
  @ApiProperty({ nullable: true, type: String }) sentAt!: string | null;
  @ApiProperty() createdAt!: string;
}
