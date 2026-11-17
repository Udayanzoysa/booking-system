import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PermissionCode, RequirePermissions } from '../rbac/permissions';
import type { AuthPrincipal } from './auth-principal';
import { CurrentUser } from './auth.decorators';
import { CreateStaffDto, ListStaffDto } from './auth.dto';
import { AuthService } from './auth.service';

@RequirePermissions(PermissionCode.MANAGE_USERS)
@Controller('users')
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  listStaff(@CurrentUser() principal: AuthPrincipal, @Query() query: ListStaffDto) {
    return this.auth.listStaff(principal.tenantId, query);
  }

  @Post()
  createStaff(@CurrentUser() principal: AuthPrincipal, @Body() dto: CreateStaffDto) {
    return this.auth.createStaff(principal.tenantId, dto);
  }
}
