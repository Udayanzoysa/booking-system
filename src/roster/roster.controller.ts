import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators';
import type { AuthPrincipal } from '../auth/auth-principal';
import { TimeRangeDto } from '../lanes/time-range.dto';
import { PermissionCode, RequirePermissions } from '../rbac/permissions';
import { CreateRosterShiftDto } from './roster.dto';
import { RosterService } from './roster.service';

@Controller('branches/:branchId/roster')
@RequirePermissions(PermissionCode.MANAGE_ROSTER)
export class RosterController {
  constructor(private readonly roster: RosterService) {}

  @Get()
  list(
    @CurrentUser() user: AuthPrincipal,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: TimeRangeDto,
  ) {
    return this.roster.list(user.tenantId, branchId, query);
  }

  @Post()
  create(
    @CurrentUser() user: AuthPrincipal,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: CreateRosterShiftDto,
  ) {
    return this.roster.create(user.tenantId, branchId, dto);
  }

  @Delete(':shiftId')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthPrincipal,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('shiftId', ParseUUIDPipe) shiftId: string,
  ) {
    return this.roster.remove(user.tenantId, branchId, shiftId);
  }
}
