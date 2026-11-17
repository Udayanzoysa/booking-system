import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StaffRoster } from '@prisma/client';
import { AvailabilityEvents } from '../availability/availability.events';
import { readTimeRange, TimeRangeDto } from '../lanes/time-range.dto';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionCode } from '../rbac/permissions';
import { CreateRosterShiftDto } from './roster.dto';

const staffPermissions = Object.values(PermissionCode).filter((code) => code !== PermissionCode.CREATE_UNPAID_HOLD);
const activeStaff: Prisma.UserWhereInput = {
  isActive: true,
  roles: {
    some: {
      role: { permissions: { some: { permission: { code: { in: staffPermissions } } } } },
    },
  },
};

export function hasShiftCoverage(
  shifts: ReadonlyArray<Pick<StaffRoster, 'startsAt' | 'endsAt'>>,
  startsAt: Date,
  endsAt: Date,
) {
  let coveredThrough = startsAt.getTime();
  for (const shift of shifts) {
    if (shift.startsAt.getTime() > coveredThrough) {
      return false;
    }

    coveredThrough = Math.max(coveredThrough, shift.endsAt.getTime());
    if (coveredThrough >= endsAt.getTime()) {
      return true;
    }
  }
  return false;
}

@Injectable()
export class RosterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityEvents,
  ) {}

  async coverageShifts(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
    startsAt: Date,
    endsAt: Date,
  ) {
    return tx.staffRoster.findMany({
      where: {
        tenantId,
        branchId,
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        staff: activeStaff,
      },
      orderBy: { startsAt: 'asc' },
      select: { startsAt: true, endsAt: true },
    });
  }

  async isStaffed(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
    startsAt: Date,
    endsAt: Date,
  ) {
    const shifts = await this.coverageShifts(tx, tenantId, branchId, startsAt, endsAt);
    return hasShiftCoverage(shifts, startsAt, endsAt);
  }

  async list(tenantId: string, branchId: string, query: TimeRangeDto) {
    const { startsAt, endsAt } = readTimeRange(query, 31);
    return this.prisma.staffRoster.findMany({
      where: { tenantId, branchId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
      orderBy: { startsAt: 'asc' },
      include: { staff: { select: { id: true, displayName: true } } },
    });
  }

  async create(tenantId: string, branchId: string, dto: CreateRosterShiftDto) {
    const { startsAt, endsAt } = readTimeRange(dto, 1);
    const shift = await this.prisma.$transaction(async (tx) => {
      // Serialize shift creation across all branches for a staff member.
      await tx.$queryRaw`
        SELECT id FROM "User"
        WHERE "tenantId" = ${tenantId}::uuid AND id = ${dto.staffId}::uuid
        FOR UPDATE
      `;
      const staff = await tx.user.findFirst({
        where: { tenantId, id: dto.staffId, ...activeStaff },
        select: { id: true },
      });
      const branch = await tx.branch.findFirst({
        where: { tenantId, id: branchId, isActive: true },
        select: { id: true },
      });
      if (!branch || !staff) {
        throw new NotFoundException('Active branch or staff member not found');
      }

      const overlap = await tx.staffRoster.findFirst({
        where: { tenantId, staffId: dto.staffId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
        select: { id: true },
      });
      if (overlap) {
        throw new ConflictException('The staff member already has an overlapping shift');
      }
      return tx.staffRoster.create({ data: { tenantId, branchId, staffId: staff.id, startsAt, endsAt } });
    });

    this.availability.changed(tenantId);
    return shift;
  }

  async remove(tenantId: string, branchId: string, shiftId: string) {
    const { count } = await this.prisma.staffRoster.deleteMany({ where: { tenantId, branchId, id: shiftId } });
    if (count === 0) {
      throw new NotFoundException('Shift not found');
    }
    this.availability.changed(tenantId);
  }
}
