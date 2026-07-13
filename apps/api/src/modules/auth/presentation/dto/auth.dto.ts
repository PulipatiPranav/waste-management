import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class RequestOtpDto {
  @ApiProperty({
    example: '+919876543210',
    description: 'E.164 preferred. A bare Indian 10-digit number is also accepted and normalised.',
  })
  @IsString()
  @MaxLength(20)
  phone!: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: '+919876543210' })
  @IsString()
  @MaxLength(20)
  phone!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  // Digits only, bounded length. Stops a 10MB body or a regex-hostile string from
  // ever reaching Argon2, which would otherwise happily spend CPU hashing it.
  @Matches(/^\d+$/, { message: 'code must contain digits only' })
  @Length(4, 8)
  code!: string;
}

export class RefreshTokenDto {
  @ApiProperty({ description: 'The opaque refresh token from a previous login or refresh.' })
  @IsString()
  @MaxLength(200)
  refreshToken!: string;
}

export class StaffLoginDto {
  @ApiProperty({ example: 'ops@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'correct horse battery staple' })
  @IsString()
  @MinLength(12, { message: 'password must be at least 12 characters' })
  // Argon2 hashes whatever it is given; without a ceiling, a multi-megabyte password
  // is a free CPU-exhaustion DoS on an unauthenticated endpoint.
  @MaxLength(128)
  password!: string;
}

// --- Responses ---------------------------------------------------------------

export class RequestOtpResponseDto {
  @ApiProperty({ example: 300 })
  expiresInSeconds!: number;

  @ApiProperty({
    example: 'If that number is valid, a code has been sent.',
    description:
      'Deliberately non-committal: the response is identical whether or not the number is registered.',
  })
  message!: string;
}

export class SessionResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty({ description: 'Store securely (flutter_secure_storage / httpOnly cookie).' })
  refreshToken!: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType!: string;

  @ApiProperty({ example: 900, description: 'Access token lifetime.' })
  expiresInSeconds!: number;
}

export class OtpSessionResponseDto extends SessionResponseDto {
  @ApiProperty({ description: 'True when this verification created the account.' })
  isNewUser!: boolean;
}
