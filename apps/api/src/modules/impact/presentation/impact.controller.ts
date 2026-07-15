import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
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
import { ImpactUseCases } from '../application/impact.use-cases';
import { toImpactReportDto } from './impact.mapper';

/**
 * The customer's own sustainability dashboard. Served from the nightly cache, so it is cheap
 * to hit as often as an app screen wants.
 */
@ApiTags('impact')
@ApiBearerAuth()
@Controller({ path: 'impact', version: '1' })
export class ImpactController {
  constructor(private readonly impact: ImpactUseCases) {}

  @Get('me')
  @ApiOperation({
    summary: 'My recycling impact',
    description:
      'Lifetime totals plus a monthly trend, derived from the paper a mill has CONFIRMED ' +
      'receiving. Every figure is an ESTIMATE — see the disclaimer and methodology in the ' +
      'response.',
  })
  @ApiOkResponse()
  async me(@CurrentUser() current: AuthenticatedUser) {
    return toImpactReportDto(await this.impact.forUser(current.id));
  }
}

/**
 * Org and platform dashboards, plus the cache-refresh control. Staff only: one customer must
 * not see another's impact, and an apartment's aggregate is org-internal.
 */
@ApiTags('admin/impact')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Requires OPS_STAFF or SUPER_ADMIN.' })
@Roles('OPS_STAFF', 'SUPER_ADMIN')
@Controller({ path: 'admin/impact', version: '1' })
export class AdminImpactController {
  constructor(private readonly impact: ImpactUseCases) {}

  @Get('platform')
  @ApiOperation({ summary: 'Whole-platform recycling impact' })
  @ApiOkResponse()
  async platform() {
    return toImpactReportDto(await this.impact.forPlatform());
  }

  @Get('users/:userId')
  @ApiOperation({ summary: 'A customer’s impact (support / their own ESG queries)' })
  @ApiOkResponse()
  async user(@Param('userId', ParseUUIDPipe) userId: string) {
    return toImpactReportDto(await this.impact.forUser(userId));
  }

  @Get('apartments/:apartmentId')
  @ApiOperation({
    summary: 'An apartment’s aggregate impact',
    description:
      'Rolls up over the apartment’s member residents. Reports zero until Phase 7 wires org ' +
      'membership — by design, not a bug.',
  })
  @ApiOkResponse()
  async apartment(@Param('apartmentId', ParseUUIDPipe) apartmentId: string) {
    return toImpactReportDto(await this.impact.forApartment(apartmentId));
  }

  @Get('businesses/:businessId')
  @ApiOperation({
    summary: 'A business’s aggregate impact (for their CSR / ESG report)',
    description:
      'Rolls up over the business’s member employees. Zero until Phase 7. See the disclaimer.',
  })
  @ApiOkResponse()
  async business(@Param('businessId', ParseUUIDPipe) businessId: string) {
    return toImpactReportDto(await this.impact.forBusiness(businessId));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Force a cache recompute',
    description:
      'The same recompute the nightly job runs, exposed so ops can refresh dashboards after a ' +
      'weighbridge correction instead of waiting until 03:00.',
  })
  @ApiOkResponse()
  refresh() {
    return this.impact.refreshCache();
  }
}
