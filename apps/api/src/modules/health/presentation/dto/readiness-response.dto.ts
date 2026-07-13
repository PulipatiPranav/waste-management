import { ApiProperty } from '@nestjs/swagger';

export class ProbeResultDto {
  @ApiProperty({ example: 'postgres' })
  name!: string;

  @ApiProperty({ enum: ['up', 'down'], example: 'up' })
  status!: 'up' | 'down';

  @ApiProperty({ example: 3 })
  durationMs!: number;
}

export class ReadinessResponseDto {
  @ApiProperty({ enum: ['ok', 'degraded', 'error'], example: 'ok' })
  status!: 'ok' | 'degraded' | 'error';

  @ApiProperty({ example: '2026-07-13T09:41:00.000Z' })
  checkedAt!: string;

  // The probe's `error` message is deliberately not exposed here: this endpoint is
  // unauthenticated for Kubernetes, and a connection error can carry a host or DSN.
  @ApiProperty({ type: [ProbeResultDto] })
  probes!: ProbeResultDto[];
}
