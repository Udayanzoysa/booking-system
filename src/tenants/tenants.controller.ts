import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators';
import type { AuthPrincipal } from '../auth/auth-principal';
import { PermissionCode, RequirePermissions } from '../rbac/permissions';
import { CreateBranchDto, UpdateBranchDto, UpdateTenantDto } from './tenants.dto';
import { TenantsService } from './tenants.service';

@Controller()
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get('tenants/current')
  current(@CurrentUser() user: AuthPrincipal) {
    return this.tenants.current(user.tenantId);
  }

  @Patch('tenants/current')
  @RequirePermissions(PermissionCode.MANAGE_TENANT)
  update(@CurrentUser() user: AuthPrincipal, @Body() dto: UpdateTenantDto) {
    return this.tenants.update(user.tenantId, dto);
  }

  @Get('branches')
  branches(@CurrentUser() user: AuthPrincipal) {
    return this.tenants.branches(user.tenantId, user.permissions.has(PermissionCode.MANAGE_TENANT));
  }

  @Post('branches')
  @RequirePermissions(PermissionCode.MANAGE_TENANT)
  createBranch(@CurrentUser() user: AuthPrincipal, @Body() dto: CreateBranchDto) {
    return this.tenants.createBranch(user.tenantId, dto);
  }

  @Patch('branches/:branchId')
  @RequirePermissions(PermissionCode.MANAGE_TENANT)
  updateBranch(
    @CurrentUser() user: AuthPrincipal,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.tenants.updateBranch(user.tenantId, branchId, dto);
  }
}
