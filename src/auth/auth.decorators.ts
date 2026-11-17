import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthPrincipal } from './auth-principal';

export const PUBLIC_ROUTE = Symbol('PUBLIC_ROUTE');

export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

export interface AuthenticatedRequest {
  headers: { authorization?: string };
  principal?: AuthPrincipal;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPrincipal => {
    const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().principal;
    if (!principal) {
      throw new UnauthorizedException();
    }
    return principal;
  },
);
