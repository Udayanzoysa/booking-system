import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AvailabilityEvents } from '../availability/availability.events';
import { blockingBookingAt } from '../lanes/availability';
import { lockLanes } from '../prisma/lane-lock';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionCode } from '../rbac/permissions';
import { CreateBranchDto, UpdateBranchDto, UpdateTenantDto } from './tenants.dto';

function canonicalTimeZone(input: string) {
  try {
    // DateTimeFormat also accepts fixed offsets. Branch hours require an IANA zone.
    if (/^[+-]/u.test(input)) {
      throw new RangeError();
    }
    return new Intl.DateTimeFormat('en', { timeZone: input }).resolvedOptions().timeZone;
  } catch {
    throw new BadRequestException('timeZone must be an IANA time zone');
  }
}

async function validateLeadOwner(tx: Prisma.TransactionClient, tenantId: string, userId: string) {
  const owner = await tx.user.findFirst({
    where: {
      tenantId,
      id: userId,
      isActive: true,
      roles: { some: { role: { permissions: { some: { permission: { code: PermissionCode.MANAGE_BOOKINGS } } } } } },
    },
    select: { id: true },
  });
  if (!owner) {
    throw new BadRequestException('The web lead owner must be an active staff member with booking permissions');
  }
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityEvents,
  ) {}

  current(tenantId: string) {
    return this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  }

  update(tenantId: string, dto: UpdateTenantDto) {
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: { name: dto.name?.trim(), unpaidHoldMinutes: dto.unpaidHoldMinutes },
    });
  }

  branches(tenantId: string, administer: boolean) {
    return this.prisma.branch.findMany({
      where: { tenantId, isActive: administer ? undefined : true },
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true, timeZone: true, isActive: true, webLeadOwnerId: administer },
    });
  }

  async createBranch(tenantId: string, dto: CreateBranchDto) {
    const timeZone = canonicalTimeZone(dto.timeZone);
    const branch = await this.prisma.$transaction(async (tx) => {
      if (dto.webLeadOwnerId) {
        await validateLeadOwner(tx, tenantId, dto.webLeadOwnerId);
      }

      return tx.branch.create({
        data: { tenantId, code: dto.code, name: dto.name.trim(), timeZone, webLeadOwnerId: dto.webLeadOwnerId },
      });
    });
    this.availability.changed(tenantId);
    return branch;
  }

  async updateBranch(tenantId: string, branchId: string, dto: UpdateBranchDto) {
    const timeZone = dto.timeZone === undefined ? undefined : canonicalTimeZone(dto.timeZone);
    const branch = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM "Branch" WHERE "tenantId" = ${tenantId}::uuid AND id = ${branchId}::uuid FOR UPDATE
      `;
      await tx.branch.findUniqueOrThrow({ where: { tenantId_id: { tenantId, id: branchId } } });
      if (dto.isActive === false || timeZone !== undefined) {
        const lanes = await tx.lane.findMany({ where: { tenantId, branchId }, select: { id: true } });
        await lockLanes(tx, tenantId, lanes.map(({ id }) => id));
      }
      if (dto.isActive === false) {
        const now = new Date();
        const futureBooking = await tx.booking.findFirst({
          where: { tenantId, slot: { lane: { branchId }, endsAt: { gt: now } }, ...blockingBookingAt(now) },
          select: { id: true },
        });
        if (futureBooking) {
          throw new ConflictException('Move or cancel active bookings before deactivating the branch');
        }
      }
      if (dto.webLeadOwnerId) {
        await validateLeadOwner(tx, tenantId, dto.webLeadOwnerId);
      }

      return tx.branch.update({
        where: { tenantId_id: { tenantId, id: branchId } },
        data: { name: dto.name?.trim(), timeZone, isActive: dto.isActive, webLeadOwnerId: dto.webLeadOwnerId },
      });
    });
    this.availability.changed(tenantId);
    return branch;
  }
}
