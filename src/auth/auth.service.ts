import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionCode, WEB_CUSTOMER_ROLE_NAME } from '../rbac/permissions';
import { isSampleDatabase } from '../sample-database';
import type { AuthPrincipal } from './auth-principal';
import { CreateStaffDto, GoogleLoginDto, ListStaffDto, LoginDto, RegisterDto, type DemoAccount } from './auth.dto';
import { hashPassword, verifyPassword } from './password';
import { GoogleIdentityVerifier } from './google-identity-verifier';

const TOKEN_LIFETIME_SECONDS = 60 * 60;

const staffAccountSelect = {
  id: true,
  email: true,
  displayName: true,
  isActive: true,
} satisfies Prisma.UserSelect;

const googleCustomerSelect = {
  id: true, tenantId: true, email: true, googleSubject: true, isActive: true,
  customer: { select: { id: true } },
  roles: { select: { role: { select: { permissions: { select: { permission: { select: { code: true } } } } } } } },
} satisfies Prisma.UserSelect;

function assertGoogleCustomer(user: Prisma.UserGetPayload<{ select: typeof googleCustomerSelect }>) {
  if (!user.isActive) throw new UnauthorizedException('This player account is inactive. Contact the club.');
  if (!user.customer || user.roles.some(({ role }) => role.permissions.some(({ permission }) => permission.code !== PermissionCode.CREATE_UNPAID_HOLD))) {
    throw new ForbiddenException('Google sign-in is available for player accounts. Staff must use the staff sign-in page.');
  }
}

function handleDuplicateEmail(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new ConflictException('An account already exists for this email');
  }
  throw error;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly googleIdentity: GoogleIdentityVerifier,
  ) {}

  async loginDemo(account: DemoAccount, origin?: string) {
    const host = process.env.HOST ?? '127.0.0.1';
    if (process.env.TECHWING_QUICK_DEMO !== '1' || !isSampleDatabase() ||
        !['127.0.0.1', '::1'].includes(host) ||
        !origin || origin !== process.env.FRONTEND_ORIGIN ||
        !/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/u.test(origin)) {
      throw new NotFoundException();
    }

    const user = await this.prisma.user.findFirstOrThrow({
      where: {
        email: account + '@example.test',
        tenant: { slug: 'techwing-auth-sample' },
        isActive: true,
      },
      select: { id: true, tenantId: true, displayName: true },
    });
    return { ...await this.signAccessToken(user.id, user.tenantId), displayName: user.displayName };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        email: dto.email.toLowerCase(),
        tenant: { slug: dto.tenantSlug.trim().toLowerCase() },
      },
      select: { id: true, tenantId: true, isActive: true, passwordHash: true },
    });

    const matches = await verifyPassword(dto.password, user?.passwordHash);
    if (!user?.isActive || !matches) {
      throw new UnauthorizedException('Invalid tenant or credentials');
    }

    return this.signAccessToken(user.id, user.tenantId);
  }

  async register(dto: RegisterDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: dto.tenantSlug.trim().toLowerCase() },
      select: { id: true },
    });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const email = dto.email.toLowerCase();
    const passwordHash = await hashPassword(dto.password);
    const user = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email,
          displayName: dto.displayName,
          passwordHash,
        },
        select: { id: true, tenantId: true },
      });
      await tx.customer.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          name: dto.displayName,
          email,
          phone: dto.phone,
        },
      });

      const role = await tx.role.findUnique({
        where: { tenantId_name: { tenantId: tenant.id, name: WEB_CUSTOMER_ROLE_NAME } },
        select: {
          id: true,
          permissions: { select: { permission: { select: { code: true } } } },
        },
      });
      if (
        role?.permissions.length === 1 &&
        role.permissions[0].permission.code === PermissionCode.CREATE_UNPAID_HOLD
      ) {
        await tx.userRole.create({
          data: { tenantId: tenant.id, userId: user.id, roleId: role.id },
        });
      }
      return user;
    }).catch(handleDuplicateEmail);

    return this.signAccessToken(user.id, user.tenantId);
  }

  async loginGoogle(dto: GoogleLoginDto) {
    const identity = await this.googleIdentity.verify(dto.credential, dto.nonce);
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: dto.tenantSlug }, select: { id: true } });
    if (!tenant) throw new NotFoundException('Arena not found');
    const user = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenant.id}::uuid FOR UPDATE`;
      const linked = await tx.user.findUnique({
        where: { tenantId_googleSubject: { tenantId: tenant.id, googleSubject: identity.subject } },
        select: googleCustomerSelect,
      });
      if (linked) { assertGoogleCustomer(linked); return linked; }

      const existingEmail = await tx.user.findUnique({
        where: { tenantId_email: { tenantId: tenant.id, email: identity.email } }, select: googleCustomerSelect,
      });
      if (existingEmail) {
        assertGoogleCustomer(existingEmail);
        throw new ConflictException(existingEmail.googleSubject
          ? 'This player account is connected to a different Google account. Sign in with your existing account.'
          : 'An account already uses this email. Sign in with your password, then choose Connect Google to link it.');
      }
      const role = await tx.role.findUnique({
        where: { tenantId_name: { tenantId: tenant.id, name: WEB_CUSTOMER_ROLE_NAME } },
        select: { id: true, permissions: { select: { permission: { select: { code: true } } } } },
      });
      if (role?.permissions.length !== 1 || role.permissions[0].permission.code !== PermissionCode.CREATE_UNPAID_HOLD) {
        throw new ServiceUnavailableException('Player registration is not available for this arena. Contact the club.');
      }
      const created = await tx.user.create({ data: {
        tenantId: tenant.id, email: identity.email, displayName: identity.displayName, googleSubject: identity.subject,
      }, select: { id: true, tenantId: true } });
      await tx.customer.create({ data: {
        tenantId: tenant.id, userId: created.id, name: identity.displayName, email: identity.email,
      } });
      await tx.userRole.create({ data: { tenantId: tenant.id, userId: created.id, roleId: role.id } });
      return created;
    }).catch(handleDuplicateEmail);
    return this.signAccessToken(user.id, user.tenantId, 'google');
  }

  async linkGoogle(principal: AuthPrincipal, dto: GoogleLoginDto) {
    if (dto.tenantSlug !== principal.tenantSlug) throw new ForbiddenException('Use your current player arena when connecting Google.');
    const identity = await this.googleIdentity.verify(dto.credential, dto.nonce);
    const user = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${principal.tenantId}::uuid FOR UPDATE`;
      const current = await tx.user.findUnique({
        where: { tenantId_id: { tenantId: principal.tenantId, id: principal.userId } }, select: googleCustomerSelect,
      });
      if (!current) throw new UnauthorizedException('Sign in to your player account again.');
      assertGoogleCustomer(current);
      if (identity.email !== current.email.toLowerCase()) throw new ForbiddenException('Choose the Google account matching your player account email.');
      if (current.googleSubject && current.googleSubject !== identity.subject) {
        throw new ConflictException('This player account is already connected to another Google account.');
      }
      const linked = await tx.user.findUnique({
        where: { tenantId_googleSubject: { tenantId: principal.tenantId, googleSubject: identity.subject } }, select: { id: true },
      });
      if (linked && linked.id !== current.id) throw new ConflictException('This Google account is already connected to another player account.');
      if (!current.googleSubject) await tx.user.update({ where: { id: current.id }, data: { googleSubject: identity.subject } });
      return current;
    }).catch(handleDuplicateEmail);
    return this.signAccessToken(user.id, user.tenantId, 'google');
  }

  async listStaff(tenantId: string, query: ListStaffDto) {
    const limit = query.limit ?? 50;
    const rows = await this.prisma.user.findMany({
      where: {
        tenantId,
        customer: { is: null },
        id: query.cursor ? { gt: query.cursor } : undefined,
      },
      orderBy: { id: 'asc' },
      take: limit + 1,
      select: staffAccountSelect,
    });
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items[limit - 1].id : null };
  }

  async createStaff(tenantId: string, dto: CreateStaffDto) {
    const passwordHash = await hashPassword(dto.password);
    return this.prisma.user.create({
      data: {
        tenantId,
        email: dto.email.toLowerCase(),
        displayName: dto.displayName,
        passwordHash,
      },
      select: staffAccountSelect,
    }).catch(handleDuplicateEmail);
  }

  async verifyAccessToken(token: string): Promise<AuthPrincipal> {
    const claims = await this.jwt
      .verifyAsync<{ sub?: unknown; tenantId?: unknown; exp?: unknown; authMethod?: unknown }>(token)
      .catch(() => {
        throw new UnauthorizedException('Invalid or expired access token');
      });

    if (
      typeof claims.sub !== 'string' ||
      !isUUID(claims.sub) ||
      typeof claims.tenantId !== 'string' ||
      !isUUID(claims.tenantId) ||
      typeof claims.exp !== 'number' ||
      !Number.isSafeInteger(claims.exp) ||
      (claims.authMethod !== undefined && claims.authMethod !== 'google' && claims.authMethod !== 'password')
    ) {
      throw new UnauthorizedException('Invalid access token');
    }

    const tenantId = claims.tenantId;
    const user = await this.prisma.user.findUnique({
      where: { tenantId_id: { tenantId, id: claims.sub } },
      select: {
        id: true,
        displayName: true,
        tenant: { select: { slug: true } },
        isActive: true,
        googleSubject: true,
        customer: { select: { id: true } },
        roles: {
          select: {
            role: {
              select: {
                name: true,
                permissions: { select: { permission: { select: { code: true } } } },
              },
            },
          },
        },
      },
    });
    if (!user?.isActive) {
      throw new UnauthorizedException('Inactive or unknown account');
    }
    if (claims.authMethod === 'google' && (!user.googleSubject || !user.customer
      || user.roles.some(({ role }) => role.permissions.some(({ permission }) => permission.code !== PermissionCode.CREATE_UNPAID_HOLD)))) {
      throw new UnauthorizedException('Google sign-in is limited to player accounts. Use password sign-in for staff access.');
    }

    const permissions = new Set<string>();
    for (const { role } of user.roles) {
      for (const { permission } of role.permissions) {
        if (
          role.name !== WEB_CUSTOMER_ROLE_NAME ||
          permission.code === PermissionCode.CREATE_UNPAID_HOLD
        ) {
          permissions.add(permission.code);
        }
      }
    }
    return {
      tenantId, userId: user.id, displayName: user.displayName, tenantSlug: user.tenant.slug,
      expiresAt: claims.exp * 1000, permissions,
    };
  }

  private async signAccessToken(userId: string, tenantId: string, authMethod: 'password' | 'google' = 'password') {
    return {
      tokenType: 'Bearer',
      accessToken: await this.jwt.signAsync({ tenantId, authMethod }, {
        subject: userId,
        expiresIn: TOKEN_LIFETIME_SECONDS,
      }),
      expiresIn: TOKEN_LIFETIME_SECONDS,
    };
  }
}
