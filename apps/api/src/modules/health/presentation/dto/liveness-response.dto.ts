import { ApiProperty } from '@nestjs/swagger';
import { type HealthCheckResponse } from '@cpe/shared-types';

/**
 * `implements HealthCheckResponse` is load-bearing: it makes the compiler fail if
 * this endpoint's shape drifts from the contract the admin dashboard consumes.
 */
export class LivenessResponseDto implements HealthCheckResponse {
  @ApiProperty({ enum: ['ok', 'degraded', 'error'], example: 'ok' })
  status!: 'ok' | 'degraded' | 'error';

  @ApiProperty({ example: 128 })
  uptimeSeconds!: number;

  @ApiProperty({ example: '0.0.0' })
  version!: string;

  @ApiProperty({ example: '2026-07-13T09:41:00.000Z' })
  timestamp!: string;
}
