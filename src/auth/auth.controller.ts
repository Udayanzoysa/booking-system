import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser, Public } from './auth.decorators';
import type { AuthPrincipal } from './auth-principal';
import { DemoLoginDto, GoogleLoginDto, LoginDto, RegisterDto } from './auth.dto';
import { googleClientId } from './google-identity-verifier';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Get('google/config')
  googleConfig() {
    const clientId = googleClientId();
    return clientId ? { enabled: true, clientId } : { enabled: false };
  }

  @Public()
  @Post('google')
  @HttpCode(HttpStatus.OK)
  google(@Body() dto: GoogleLoginDto) {
    return this.auth.loginGoogle(dto);
  }

  @Post('google/link')
  @HttpCode(HttpStatus.OK)
  linkGoogle(@CurrentUser() principal: AuthPrincipal, @Body() dto: GoogleLoginDto) {
    return this.auth.linkGoogle(principal, dto);
  }

  @Public()
  @Post('demo')
  @HttpCode(HttpStatus.OK)
  demo(@Body() dto: DemoLoginDto, @Headers('origin') origin?: string) {
    return this.auth.loginDemo(dto.account, origin);
  }

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Get('me')
  me(@CurrentUser() principal: AuthPrincipal) {
    return {
      tenantId: principal.tenantId,
      userId: principal.userId,
      displayName: principal.displayName,
      tenantSlug: principal.tenantSlug,
      expiresAt: principal.expiresAt,
      permissions: [...principal.permissions].sort(),
    };
  }
}
