import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators';
import type { AuthPrincipal } from '../auth/auth-principal';
import { PermissionCode, RequirePermissions } from '../rbac/permissions';
import { PublishCancellationPolicyDto } from './policies.dto';
import { PoliciesService } from './policies.service';

@Controller('cancellation-policies')
export class PoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  @Get()
  list(@CurrentUser() user: AuthPrincipal) {
    return this.policies.list(user.tenantId, user.permissions.has(PermissionCode.MANAGE_POLICIES));
  }

  @Post()
  @RequirePermissions(PermissionCode.MANAGE_POLICIES)
  publish(@CurrentUser() user: AuthPrincipal, @Body() dto: PublishCancellationPolicyDto) {
    return this.policies.publish(user.tenantId, dto);
  }
}
