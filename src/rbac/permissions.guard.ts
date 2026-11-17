import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../auth/auth.decorators';
import { PermissionCode, REQUIRED_PERMISSIONS } from './permissions';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndMerge<PermissionCode[]>(REQUIRED_PERMISSIONS, [
      context.getClass(),
      context.getHandler(),
    ]);
    if (!required.length) {
      return true;
    }

    const { principal } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!principal) {
      throw new UnauthorizedException();
    }
    if (!required.every((code) => principal.permissions.has(code))) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
