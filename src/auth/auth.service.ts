import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionCode, WEB_CUSTOMER_ROLE_NAME } from '../rbac/permissions';
import { isSampleDatabase } from '../sample-database';
import type { AuthPrincipal } from './auth-principal';
import { CreateStaffDto, ListStaffDto, LoginDto, RegisterDto, type DemoAccount } from './auth.dto';
import { hashPassword, verifyPassword } from './password';

const TOKEN_LIFETIME_SECONDS = 60 * 60;

const staffAccountSelect = {
  id: true,
  email: true,
  displayName: true,
  isActive: true,
} satisfies Prisma.UserSelect;

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
      .verifyAsync<{ sub?: unknown; tenantId?: unknown; exp?: unknown }>(token)
      .catch(() => {
        throw new UnauthorizedException('Invalid or expired access token');
      });

    if (
      typeof claims.sub !== 'string' ||
      !isUUID(claims.sub) ||
      typeof claims.tenantId !== 'string' ||
      !isUUID(claims.tenantId) ||
      typeof claims.exp !== 'number' ||
      !Number.isSafeInteger(claims.exp)
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

  private async signAccessToken(userId: string, tenantId: string) {
    return {
      tokenType: 'Bearer',
      accessToken: await this.jwt.signAsync({ tenantId }, {
        subject: userId,
        expiresIn: TOKEN_LIFETIME_SECONDS,
      }),
      expiresIn: TOKEN_LIFETIME_SECONDS,
    };
  }
}
