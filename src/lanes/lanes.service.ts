import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BookingPaymentStatus, BookingStatus, Prisma, SlotKind } from '@prisma/client';
import { AvailabilityEvents } from '../availability/availability.events';
import { lockLanes } from '../prisma/lane-lock';
import { PrismaService } from '../prisma/prisma.service';
import { hasShiftCoverage, RosterService } from '../roster/roster.service';
import { blockingBookingAt } from './availability';
import { lanePriceCalculator } from './lane-pricing.service';
import { CreateLaneDto, CreateSlotDto, ReplaceLanePricingDto, UpdateLaneDto } from './lanes.dto';
import { readTimeRange, TimeRangeDto } from './time-range.dto';

type CalendarStatus = 'AVAILABLE' | 'UNPRICED' | 'MAINTENANCE' | 'HELD' | 'PAID' | 'RESERVED';

const calendarStatusPriority: Record<CalendarStatus, number> = {
  AVAILABLE: 0,
  UNPRICED: 0,
  HELD: 1,
  RESERVED: 2,
  PAID:  3,
  MAINTENANCE: 4,
};

function overlaps(a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) {
  return a.startsAt < b.endsAt && a.endsAt > b.startsAt;
}

@Injectable()
export class LanesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: AvailabilityEvents,
    private readonly roster: RosterService,
  ) {}

  private async publicArena(slug: string) {
    if (slug.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new NotFoundException('Arena not found');
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, name: true, currency: true, paymentSettings: { select: { contactPhone: true } },
        branches: { where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true, timeZone: true } } },
    });
    if (!tenant) throw new NotFoundException('Arena not found');
    return tenant;
  }

  async publicTenant(slug: string) {
    const tenant = await this.publicArena(slug);
    return { name: tenant.name, currency: tenant.currency, branches: tenant.branches,
      contactPhone: tenant.paymentSettings?.contactPhone || '070 126 1966' };
  }

  async publicAvailability(slug: string, branchId: string, query: TimeRangeDto) {
    const tenant = await this.publicArena(slug);
    if (!tenant.branches.some((branch) => branch.id === branchId)) throw new NotFoundException('Active branch not found');
    const grid = await this.availability(tenant.id, branchId, query);
    // Explicit public projection: do not expose customer, booking, staff, or tenant IDs.
    return { branchId: grid.branchId, timeZone: grid.timeZone, currency: grid.currency,
      contactPhone: tenant.paymentSettings?.contactPhone || '070 126 1966',
      lanes: grid.lanes.map(({ id, name, type }) => ({ id, name, type })),
      slots: grid.slots.map(({ id, laneId, startsAt, endsAt, status, price, kind, pricingTiers }) =>
        ({ id, laneId, startsAt, endsAt, status, price, kind, pricingTiers })),
    };
  }

  list(tenantId: string, branchId: string, includeInactive: boolean) {
    return this.prisma.lane.findMany({
      where: {
        tenantId,
        branchId,
        ...(includeInactive ? {} : { isActive: true, branch: { isActive: true } }),
      },
      orderBy: { name: 'asc' },
    });
  }

  async create(tenantId: string, dto: CreateLaneDto) {
    const lane = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM "Branch" WHERE "tenantId" = ${tenantId}::uuid AND id = ${dto.branchId}::uuid FOR UPDATE
      `;
      const branch = await tx.branch.findFirst({
        where: { tenantId, id: dto.branchId, isActive: true },
        select: { id: true },
      });
      if (!branch) {
        throw new NotFoundException('Active branch not found');
      }
      return tx.lane.create({ data: { tenantId, branchId: dto.branchId, name: dto.name.trim(), type: dto.type } });
    });
    this.events.changed(tenantId);
    return lane;
  }

  async update(tenantId: string, laneId: string, dto: UpdateLaneDto) {
    const lane = await this.prisma.$transaction(async (tx) => {
      await lockLanes(tx, tenantId, [laneId]);
      if (dto.isActive === false) {
        const now = new Date();
        const activeBooking = await tx.booking.findFirst({
          where: { tenantId, slot: { laneId, endsAt: { gt: now } }, ...blockingBookingAt(now) },
          select: { id: true },
        });
        if (activeBooking) {
          throw new ConflictException('Move or cancel active bookings before deactivating the lane');
        }
      }
      return tx.lane.update({
        where: { tenantId_id: { tenantId, id: laneId } },
        data: { name: dto.name?.trim(), isActive: dto.isActive },
      });
    });
    this.events.changed(tenantId);
    return lane;
  }

  async replacePricing(tenantId: string, laneId: string, dto: ReplaceLanePricingDto) {
    const rules = [...dto.rules].sort((a, b) => a.dayOfWeek.localeCompare(b.dayOfWeek) || a.startMinute - b.startMinute);
    for (const [index, rule] of rules.entries()) {
      const previous = rules[index - 1];
      if (
        rule.endMinute <= rule.startMinute ||
        (previous?.dayOfWeek === rule.dayOfWeek && previous.endMinute > rule.startMinute)
      ) {
        throw new BadRequestException('Lane pricing windows must be positive and cannot overlap');
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await lockLanes(tx, tenantId, [laneId]);
      await tx.lanePricingRule.deleteMany({ where: { tenantId, laneId } });
      return tx.lanePricingRule.createManyAndReturn({
        data: rules.map((rule) => ({ ...rule, tenantId, laneId, pricePerHour: new Prisma.Decimal(rule.pricePerHour) })),
      });
    });
    this.events.changed(tenantId);
    return result;
  }

  async pricing(tenantId: string, laneId: string) {
    const lane = await this.prisma.lane.findUnique({
      where: { tenantId_id: { tenantId, id: laneId } },
      select: { pricingRules: { orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }] } },
    });
    if (!lane) {
      throw new NotFoundException('Lane not found');
    }
    return lane.pricingRules;
  }

  async createSlot(tenantId: string, laneId: string, dto: CreateSlotDto) {
    const { startsAt, endsAt } = readTimeRange(dto, 1);
    const kind = dto.kind ?? SlotKind.BOOKABLE;
    const slot = await this.prisma.$transaction(async (tx) => {
      await lockLanes(tx, tenantId, [laneId]);
      const lane = await tx.lane.findFirst({
        where: { tenantId, id: laneId, isActive: true, branch: { isActive: true } },
        select: { id: true },
      });
      if (!lane) {
        throw new NotFoundException('Active lane not found');
      }

      if (kind === SlotKind.MAINTENANCE) {
        const conflict = await tx.slotSchedule.findFirst({
          where: {
            tenantId,
            laneId,
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
            OR: [
              { kind: SlotKind.MAINTENANCE },
              { bookings: { some: blockingBookingAt(new Date()) } },
            ],
          },
          select: { id: true },
        });
        if (conflict) {
          throw new ConflictException('Maintenance overlaps an existing reservation or maintenance block');
        }
      }
      if (kind === SlotKind.BOOKABLE) {
        const existingRange = await tx.slotSchedule.findUnique({
          where: { tenantId_laneId_startsAt_endsAt_kind: { tenantId, laneId, startsAt, endsAt, kind } },
          select: { id: true, isBookingRange: true },
        });
        if (existingRange?.isBookingRange) {
          // An explicit schedule addition publishes this exact interval without
          // changing the immutable times referenced by previous reservations.
          return tx.slotSchedule.update({
            where: { tenantId_id: { tenantId, id: existingRange.id } },
            data: { isBookingRange: false },
          });
        }
      }
      return tx.slotSchedule.create({ data: { tenantId, laneId, kind, startsAt, endsAt } });
    });
    this.events.changed(tenantId);
    return slot;
  }

  async removeSlot(tenantId: string, laneId: string, slotId: string) {
    await this.prisma.$transaction(async (tx) => {
      await lockLanes(tx, tenantId, [laneId]);
      const slot = await tx.slotSchedule.findFirst({
        where: { tenantId, laneId, id: slotId },
        select: { startsAt: true, endsAt: true, _count: { select: { bookings: true, rescheduledFrom: true, rescheduledTo: true } } },
      });
      if (!slot) {
        throw new NotFoundException('Slot not found');
      }
      if (Object.values(slot._count).some((references) => references > 0)) {
        throw new ConflictException('A slot used in booking history cannot be deleted');
      }

      const overlappingHistory = await tx.slotSchedule.findFirst({
        where: {
          tenantId,
          laneId,
          id: { not: slotId },
          startsAt: { lt: slot.endsAt },
          endsAt: { gt: slot.startsAt },
          OR: [
            { bookings: { some: { tenantId } } },
            { rescheduledFrom: { some: { tenantId } } },
            { rescheduledTo: { some: { tenantId } } },
          ],
        },
        select: { id: true },
      });
      if (overlappingHistory) {
        throw new ConflictException('A slot overlapping booking history cannot be deleted');
      }

      await tx.slotSchedule.delete({ where: { tenantId_id: { tenantId, id: slotId } } });
    });
    this.events.changed(tenantId);
  }

  async availability(tenantId: string, branchId: string, query: TimeRangeDto) {
    const range = readTimeRange(query, 31);
    const { branch, blocks, shifts } = await this.prisma.$transaction(async (tx) => {
      const asOf = new Date();
      const branch = await tx.branch.findFirst({
        where: { tenantId, id: branchId, isActive: true },
        select: {
          timeZone: true,
          tenant: { select: { currency: true } },
          lanes: {
            where: { isActive: true },
            orderBy: { name: 'asc' },
            select: {
              id: true,
              name: true,
              type: true,
              pricingRules: true,
              slots: {
                where: { isBookingRange: false, startsAt: { lt: range.endsAt }, endsAt: { gt: range.startsAt } },
                orderBy: { startsAt: 'asc' },
                select: { id: true, laneId: true, startsAt: true, endsAt: true, kind: true },
              },
            },
          },
        },
      });
      if (!branch) {
        throw new NotFoundException('Active branch not found');
      }

      let startsAt = range.startsAt;
      let endsAt = range.endsAt;
      for (const lane of branch.lanes) {
        for (const slot of lane.slots) {
          startsAt = slot.startsAt < startsAt ? slot.startsAt : startsAt;
          endsAt = slot.endsAt > endsAt ? slot.endsAt : endsAt;
        }
      }

      const blocks = await tx.slotSchedule.findMany({
        where: {
          tenantId,
          lane: { branchId, isActive: true },
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
          OR: [
            { kind: SlotKind.MAINTENANCE },
            { bookings: { some: blockingBookingAt(asOf) } },
          ],
        },
        select: {
          laneId: true,
          startsAt: true,
          endsAt: true,
          kind: true,
          bookings: {
            where: blockingBookingAt(asOf),
            select: { status: true, paymentStatus: true },
          },
        },
      });
      const shifts = await this.roster.coverageShifts(tx, tenantId, branchId, startsAt, endsAt);
      return { branch, blocks, shifts };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

    const blocksByLane = new Map<string, typeof blocks>();
    for (const block of blocks) {
      const laneBlocks = blocksByLane.get(block.laneId) ?? [];
      laneBlocks.push(block);
      blocksByLane.set(block.laneId, laneBlocks);
    }

    const slots = branch.lanes.flatMap((lane) => {
      const calculate = lanePriceCalculator(branch.timeZone, lane.pricingRules);
      const laneBlocks = blocksByLane.get(lane.id) ?? [];
      return lane.slots.map((slot) => {
        const quote = slot.kind === SlotKind.BOOKABLE ? calculate(slot.startsAt, slot.endsAt) : null;
        let status: CalendarStatus = quote ? 'AVAILABLE' : 'UNPRICED';
        for (const block of laneBlocks) {
          if (!overlaps(slot, block)) {
            continue;
          }
          if (block.kind === SlotKind.MAINTENANCE) {
            status = 'MAINTENANCE';
            break;
          }

          for (const booking of block.bookings) {
            let reservation: CalendarStatus = 'HELD';
            if (booking.status === BookingStatus.CONFIRMED) {
              reservation = booking.paymentStatus === BookingPaymentStatus.FULLY_PAID ? 'PAID' : 'RESERVED';
            }
            if (calendarStatusPriority[reservation] > calendarStatusPriority[status]) {
              status = reservation;
            }
          }
        }
        return {
          ...slot,
          status,
          price: quote?.total.toFixed(4) ?? null,
          pricingTiers: quote?.tiers ?? [],
          staffed: hasShiftCoverage(shifts, slot.startsAt, slot.endsAt),
        };
      });
    });

    return {
      branchId,
      timeZone: branch.timeZone,
      currency: branch.tenant.currency,
      lanes: branch.lanes.map(({ id, name, type }) => ({ id, name, type })),
      slots,
    };
  }
}
