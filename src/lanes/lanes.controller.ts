import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators';
import type { AuthPrincipal } from '../auth/auth-principal';
import { PermissionCode, RequirePermissions } from '../rbac/permissions';
import { CreateLaneDto, CreateSlotDto, ReplaceLanePricingDto, UpdateLaneDto } from './lanes.dto';
import { LanesService } from './lanes.service';
import { TimeRangeDto } from './time-range.dto';

@Controller()
export class LanesController {
  constructor(private readonly lanes: LanesService) {}

  @Get('branches/:branchId/lanes')
  list(@CurrentUser() user: AuthPrincipal, @Param('branchId', ParseUUIDPipe) branchId: string) {
    return this.lanes.list(user.tenantId, branchId, user.permissions.has(PermissionCode.MANAGE_LANES));
  }

  @Get('branches/:branchId/availability')
  availability(
    @CurrentUser() user: AuthPrincipal,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: TimeRangeDto,
  ) {
    return this.lanes.availability(user.tenantId, branchId, query);
  }

  @Post('lanes')
  @RequirePermissions(PermissionCode.MANAGE_LANES)
  create(@CurrentUser() user: AuthPrincipal, @Body() dto: CreateLaneDto) {
    return this.lanes.create(user.tenantId, dto);
  }

  @Patch('lanes/:laneId')
  @RequirePermissions(PermissionCode.MANAGE_LANES)
  update(
    @CurrentUser() user: AuthPrincipal,
    @Param('laneId', ParseUUIDPipe) laneId: string,
    @Body() dto: UpdateLaneDto,
  ) {
    return this.lanes.update(user.tenantId, laneId, dto);
  }

  @Get('lanes/:laneId/pricing')
  @RequirePermissions(PermissionCode.MANAGE_PRICING)
  pricing(@CurrentUser() user: AuthPrincipal, @Param('laneId', ParseUUIDPipe) laneId: string) {
    return this.lanes.pricing(user.tenantId, laneId);
  }

  @Put('lanes/:laneId/pricing')
  @RequirePermissions(PermissionCode.MANAGE_PRICING)
  replacePricing(
    @CurrentUser() user: AuthPrincipal,
    @Param('laneId', ParseUUIDPipe) laneId: string,
    @Body() dto: ReplaceLanePricingDto,
  ) {
    return this.lanes.replacePricing(user.tenantId, laneId, dto);
  }

  @Post('lanes/:laneId/slots')
  @RequirePermissions(PermissionCode.MANAGE_LANES)
  createSlot(
    @CurrentUser() user: AuthPrincipal,
    @Param('laneId', ParseUUIDPipe) laneId: string,
    @Body() dto: CreateSlotDto,
  ) {
    return this.lanes.createSlot(user.tenantId, laneId, dto);
  }

  @Delete('lanes/:laneId/slots/:slotId')
  @HttpCode(204)
  @RequirePermissions(PermissionCode.MANAGE_LANES)
  removeSlot(
    @CurrentUser() user: AuthPrincipal,
    @Param('laneId', ParseUUIDPipe) laneId: string,
    @Param('slotId', ParseUUIDPipe) slotId: string,
  ) {
    return this.lanes.removeSlot(user.tenantId, laneId, slotId);
  }
}
