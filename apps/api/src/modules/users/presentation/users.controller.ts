import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '@/modules/auth/presentation/decorators/current-user.decorator';
import { Roles } from '@/modules/auth/presentation/decorators/roles.decorator';
import { type User } from '../domain/entities/user';
import { FindUserByPhoneUseCase } from '../application/use-cases/find-user-by-phone.use-case';
import { GetProfileUseCase } from '../application/use-cases/get-profile.use-case';
import { UpdateProfileUseCase } from '../application/use-cases/update-profile.use-case';
import { UpdateProfileDto, UserProfileDto } from './dto/user.dto';

@ApiTags('users')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(
    private readonly getProfile: GetProfileUseCase,
    private readonly updateProfile: UpdateProfileUseCase,
    private readonly findByPhone: FindUserByPhoneUseCase,
  ) {}

  /**
   * `/me`, not `/users/:id`.
   *
   * The id comes from the verified token, never from the URL. A `GET /users/:id` that
   * trusts its path param is textbook IDOR — user A reads user B's phone number and,
   * in Phase 4, their wallet. The only way to read *another* user is the explicitly
   * role-guarded route below.
   */
  @Get('me')
  @ApiOperation({ summary: 'Get the authenticated user’s profile' })
  @ApiOkResponse({ type: UserProfileDto })
  async me(@CurrentUser() current: AuthenticatedUser): Promise<UserProfileDto> {
    return this.toDto(await this.getProfile.execute(current.id));
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update the authenticated user’s name or email' })
  @ApiOkResponse({ type: UserProfileDto })
  async updateMe(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfileDto> {
    const user = await this.updateProfile.execute({
      userId: current.id,
      name: dto.name,
      email: dto.email,
    });

    return this.toDto(user);
  }

  /**
   * Support lookup by phone — what a customer gives when they call in. Declared before
   * `:id` so the router does not try to parse `by-phone` as a UUID.
   */
  @Get('by-phone')
  @Roles('OPS_STAFF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Find a user by phone number (staff only)' })
  @ApiQuery({ name: 'phone', example: '+919876543210' })
  @ApiOkResponse({ type: UserProfileDto })
  async byPhone(@Query('phone') phone = ''): Promise<UserProfileDto> {
    return this.toDto(await this.findByPhone.execute(phone));
  }

  /** Support lookup. Guarded, and every call will be audit-logged in Phase 9. */
  @Get(':id')
  @Roles('OPS_STAFF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get any user by id (staff only)' })
  @ApiOkResponse({ type: UserProfileDto })
  async byId(@Param('id', ParseUUIDPipe) id: string): Promise<UserProfileDto> {
    return this.toDto(await this.getProfile.execute(id));
  }

  private toDto(user: User): UserProfileDto {
    const view = user.toPublic();

    return {
      id: view.id,
      phone: view.phone,
      email: view.email,
      name: view.name,
      role: view.role,
      isActive: view.isActive,
      createdAt: view.createdAt.toISOString(),
    };
  }
}
