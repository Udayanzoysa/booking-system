import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators';
import type { AuthPrincipal } from '../auth/auth-principal';
import { PermissionCode, RequirePermissions } from './permissions';
import { CreateRoleDto, RolePermissionsDto } from './rbac.dto';
import { RbacService } from './rbac.service';

@RequirePermissions(PermissionCode.MANAGE_RBAC)
@Controller('rbac')
export class RbacController {
  constructor(private readonly rbac: RbacService) {}

  @Get('permissions')
  listPermissions() {
    return this.rbac.listPermissions();
  }

  @Get('roles')
  listRoles(@CurrentUser() principal: AuthPrincipal) {
    return this.rbac.listRoles(principal.tenantId);
  }

  @Post('roles')
  createRole(@CurrentUser() principal: AuthPrincipal, @Body() dto: CreateRoleDto) {
    return this.rbac.createRole(principal.tenantId, dto);
  }

  @Put('roles/:roleId/permissions')
  replacePermissions(
    @CurrentUser() principal: AuthPrincipal,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: RolePermissionsDto,
  ) {
    return this.rbac.replacePermissions(principal.tenantId, roleId, dto.permissionCodes);
  }

  @Put('users/:userId/roles/:roleId')
  assignRole(
    @CurrentUser() principal: AuthPrincipal,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ) {
    return this.rbac.assignRole(principal.tenantId, userId, roleId);
  }

  @Delete('users/:userId/roles/:roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeRole(
    @CurrentUser() principal: AuthPrincipal,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ) {
    return this.rbac.revokeRole(principal.tenantId, userId, roleId);
  }
}
