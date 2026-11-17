import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AvailabilityEvents } from '../availability/availability.events';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionCode, WEB_CUSTOMER_ROLE_NAME } from './permissions';
import { CreateRoleDto } from './rbac.dto';

const rolePermissions = {
  permissions: {
    select: { permission: { select: { code: true, description: true } } },
    orderBy: { permission: { code: 'asc' } },
  },
} satisfies Prisma.RoleInclude;

@Injectable()
export class RbacService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availabilityEvents: AvailabilityEvents,
  ) {}

  listPermissions() {
    return Object.values(PermissionCode).sort();
  }

  listRoles(tenantId: string) {
    return this.prisma.role.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      include: rolePermissions,
    });
  }

  createRole(tenantId: string, dto: CreateRoleDto) {
    if (dto.name === WEB_CUSTOMER_ROLE_NAME) {
      throw new ForbiddenException('This role name is reserved for self-registration');
    }
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: { tenantId, name: dto.name, description: dto.description },
        select: { id: true },
      });
      return this.setPermissions(tx, tenantId, role.id, dto.permissionCodes);
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A role with this name already exists');
      }
      throw error;
    });
  }

  async replacePermissions(tenantId: string, roleId: string, codes: PermissionCode[]) {
    const role = await this.prisma.$transaction(async (tx) => {
      // Serialize replacements for the same role, including roles with no grants yet.
      const [role] = await tx.$queryRaw<{ name: string }[]>`
        SELECT "name" FROM "Role"
        WHERE "tenantId" = ${tenantId}::uuid AND "id" = ${roleId}::uuid
        FOR UPDATE
      `;
      if (!role) {
        throw new NotFoundException('Role not found');
      }
      if (role.name === WEB_CUSTOMER_ROLE_NAME) {
        throw new ForbiddenException('The self-registration role has fixed permissions');
      }

      await tx.rolePermission.deleteMany({ where: { tenantId, roleId } });
      return this.setPermissions(tx, tenantId, roleId, codes);
    });
    this.availabilityEvents.changed(tenantId);
    return role;
  }

  async assignRole(tenantId: string, userId: string, roleId: string) {
    const { count } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findFirst({
        where: { tenantId, id: userId, isActive: true },
        select: { id: true },
      });
      if (!user) {
        throw new NotFoundException('Active user not found');
      }

      const role = await tx.role.findUnique({
        where: { tenantId_id: { tenantId, id: roleId } },
        select: { id: true },
      });
      if (!role) {
        throw new NotFoundException('Role not found');
      }

      return tx.userRole.createMany({
        data: { tenantId, userId, roleId },
        skipDuplicates: true,
      });
    });
    if (count > 0) {
      this.availabilityEvents.changed(tenantId);
    }
    return { userId, roleId };
  }

  async revokeRole(tenantId: string, userId: string, roleId: string) {
    const { count } = await this.prisma.userRole.deleteMany({ where: { tenantId, userId, roleId } });
    if (count > 0) {
      this.availabilityEvents.changed(tenantId);
    }
  }

  private async setPermissions(
    tx: Prisma.TransactionClient,
    tenantId: string,
    roleId: string,
    codes: PermissionCode[],
  ) {
    if (codes.length) {
      // Keep insertion order deterministic across roles sharing permission records.
      await tx.permission.createMany({
        data: [...codes].sort().map((code) => ({ tenantId, code })),
        skipDuplicates: true,
      });
      const permissions = await tx.permission.findMany({
        where: { tenantId, code: { in: codes } },
        select: { id: true },
      });
      await tx.rolePermission.createMany({
        data: permissions.map(({ id }) => ({ tenantId, roleId, permissionId: id })),
      });
    }

    return tx.role.findUniqueOrThrow({
      where: { tenantId_id: { tenantId, id: roleId } },
      include: rolePermissions,
    });
  }
}
