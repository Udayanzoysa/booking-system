import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingPaymentStatus,
  BookingStatus,
  LeadSource,
  PaymentMethod,
  PaymentTransactionType,
  Prisma,
  SlotKind,
  type Booking,
} from '@prisma/client';
import { AvailabilityEvents } from '../availability/availability.events';
import type { AuthPrincipal } from '../auth/auth-principal';
import { LanePricingService } from '../lanes/lane-pricing.service';
import { creditInvoiceTo, readInvoiceBalance } from '../invoices/invoice-balance';
import { readTimeRange } from '../lanes/time-range.dto';
import { PaymentsService } from '../payments/payments.service';
import { PoliciesService } from '../policies/policies.service';
import { lockLanes } from '../prisma/lane-lock';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionCode } from '../rbac/permissions';
import { RosterService } from '../roster/roster.service';
import { assertBookable } from './booking-availability';
import { withLockedBooking } from './booking-lock';
import { BookingListDto, CancelBookingDto, CreateBookingDto, RescheduleBookingDto } from './bookings.dto';
import {
  amountRefundable,
  assertCanManageBooking,
  assertUpcomingBooking,
  paymentState,
  requirePermission,
} from './booking-state';

const slotDetails = {
  include: { lane: { include: { branch: true } } },
} satisfies Prisma.SlotScheduleDefaultArgs;
type SlotDetails = Prisma.SlotScheduleGetPayload<typeof slotDetails>;

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: LanePricingService,
    private readonly roster: RosterService,
    private readonly policies: PoliciesService,
    private readonly payments: PaymentsService,
    private readonly availability: AvailabilityEvents,
  ) {}

  async list(principal: AuthPrincipal, dto: BookingListDto) {
    const limit = dto.limit ?? 50;
    const where = this.visibleBookings(principal);
    const canSeeNames = principal.permissions.has(PermissionCode.VIEW_BOOKINGS)
      || principal.permissions.has(PermissionCode.MANAGE_BOOKINGS);
    if (Boolean(dto.startsAt) !== Boolean(dto.endsAt)) {
      throw new BadRequestException('startsAt and endsAt must be supplied together');
    }
    const range = dto.startsAt && dto.endsAt
      ? readTimeRange({ startsAt: dto.startsAt, endsAt: dto.endsAt }, 31)
      : undefined;
    const rows = await this.prisma.booking.findMany({
      where: {
        ...where,
        id: dto.cursor ? { lt: dto.cursor } : undefined,
        slot: range || dto.branchId ? {
          startsAt: range ? { lt: range.endsAt } : undefined,
          endsAt: range ? { gt: range.startsAt } : undefined,
          lane: dto.branchId ? { branchId: dto.branchId } : undefined,
        } : undefined,
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: {
        slot: { ...slotDetails },
        leadOwner: { select: { displayName: true } },
        creator: { select: { displayName: true } },
        customer: canSeeNames ? { select: { name: true } } : false,
        bankTransferSlips: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, status: true, reviewNote: true, amount: true, createdAt: true } },
      },
    });
    const bookings = rows.slice(0, limit);
    return {
      bookings: bookings.map(({ leadOwner, creator, customer, bankTransferSlips, slot, ...booking }) => ({
        ...this.summary(booking),
        slot: { id: slot.id, laneId: slot.laneId, startsAt: slot.startsAt, endsAt: slot.endsAt, laneName: slot.lane.name, timeZone: slot.lane.branch.timeZone },
        latestBankTransferSlip: bankTransferSlips[0] ?? null,
        ...(canSeeNames ? {
          leadOwnerName: leadOwner.displayName,
          creatorName: creator.displayName,
          customerName: customer?.name,
        } : {}),
      })),
      nextCursor: rows.length > limit ? bookings[bookings.length - 1].id : null,
    };
  }

  async get(principal: AuthPrincipal, bookingId: string) {
    const canSeeNames = principal.permissions.has(PermissionCode.VIEW_BOOKINGS)
      || principal.permissions.has(PermissionCode.MANAGE_BOOKINGS);
    const booking = await this.prisma.booking.findFirst({
      where: { ...this.visibleBookings(principal), id: bookingId },
      include: {
        slot: { ...slotDetails },
        customer: canSeeNames ? { select: { name: true } } : false,
        leadOwner: canSeeNames ? { select: { displayName: true } } : false,
        creator: canSeeNames ? { select: { displayName: true } } : false,
        bankTransferSlips: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, status: true, reviewNote: true, amount: true, createdAt: true } },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    const { customer, leadOwner, creator, slot, bankTransferSlips, ...record } = booking;
    return {
      ...await this.withStaffing(this.prisma, record, slot),
      customerName: customer?.name,
      leadOwnerName: leadOwner?.displayName,
      creatorName: creator?.displayName,
      latestBankTransferSlip: bankTransferSlips[0] ?? null,
    };
  }

  async create(principal: AuthPrincipal, dto: CreateBookingDto) {
    const { tenantId, userId } = principal;
    const assisted = Boolean(dto.customerId);
    if (assisted) requirePermission(principal, PermissionCode.MANAGE_BOOKINGS);
    const canAssignLeadOwner = principal.permissions.has(PermissionCode.MANAGE_RBAC)
      || principal.permissions.has(PermissionCode.MANAGE_USERS);
    if (assisted && !canAssignLeadOwner && dto.leadOwnerId && dto.leadOwnerId.toLowerCase() !== userId) {
      throw new BadRequestException('Staff bookings must be attributed to the signed-in staff member');
    }
    if (dto.initialPayment && dto.initialWalletPaymentKey) {
      throw new BadRequestException('Select a single initial payment method');
    }
    if (!assisted && (
      (dto.leadSource && dto.leadSource !== LeadSource.WEB) ||
      dto.leadOwnerId || dto.cancellationPolicyId || dto.depositRequired || dto.initialPayment
    )) {
      throw new BadRequestException('Assisted booking details require a staff-created booking');
    }
    if (assisted && dto.initialWalletPaymentKey) {
      throw new BadRequestException('Wallet payments require authorization from the customer account');
    }
    if (dto.initialPayment) requirePermission(principal, PermissionCode.RECORD_PAYMENT);

    const slotIds = this.createSlotIds(dto);
    const laneId = await this.findSlotLane(tenantId, slotIds[0]);
    const result = await this.prisma.$transaction(async (tx) => {
      await lockLanes(tx, tenantId, [laneId]);
      const slot = await this.readCreateSlot(tx, tenantId, slotIds, laneId);
      const leadOwnerId = assisted ? (dto.leadOwnerId ?? userId) : slot.lane.branch.webLeadOwnerId;
      const leadSource = assisted ? (dto.leadSource ?? LeadSource.WALK_IN) : LeadSource.WEB;
      if (!leadSource || !leadOwnerId) {
        throw new BadRequestException(assisted
          ? 'Staff bookings require a lead source and lead owner'
          : 'Direct web bookings require a configured branch lead owner');
      }
      const customer = await tx.customer.findFirst({
        where: assisted ? { tenantId, id: dto.customerId } : { tenantId, userId },
        select: { id: true },
      });
      if (!customer) throw new NotFoundException('Customer profile not found');

      const initialKey = dto.initialPayment?.idempotencyKey ?? dto.initialWalletPaymentKey;
      const idempotencyKey = initialKey?.toLowerCase();
      const method = dto.initialPayment?.method ?? PaymentMethod.WALLET;
      if (idempotencyKey) {
        const existing = await tx.paymentTransaction.findUnique({
          where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
          include: { booking: true },
        });
        if (existing) {
          const previous = existing.booking;
          if (
            previous.creatorId !== userId || previous.customerId !== customer.id
            || previous.slotId !== slot.id || previous.leadSource !== leadSource
            || (assisted && previous.leadOwnerId !== leadOwnerId.toLowerCase()) || previous.headcount !== dto.headcount
            || (dto.cancellationPolicyId && previous.cancellationPolicyId !== dto.cancellationPolicyId.toLowerCase())
            || !previous.depositRequired.eq(dto.depositRequired ?? 0)
            || existing.type !== PaymentTransactionType.COLLECTION
            || existing.method !== method
            || (dto.initialPayment && !existing.amount.eq(dto.initialPayment.amount))
          ) {
            throw new ConflictException('The idempotency key is already used for another booking');
          }
          return this.withStaffing(tx, previous, slot);
        }
      }

      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const authorizedOwner = await tx.user.findFirst({
        where: {
          tenantId,
          id: leadOwnerId,
          isActive: true,
          roles: {
            some: {
              tenantId,
              role: {
                permissions: { some: { tenantId, permission: { code: PermissionCode.MANAGE_BOOKINGS } } },
              },
            },
          },
        },
        select: { id: true },
      });
      if (!authorizedOwner) throw new BadRequestException('The lead owner must be an active booking staff member');

      const policy = await tx.cancellationPolicy.findFirst({
        where: { tenantId, isActive: true, id: dto.cancellationPolicyId ?? undefined },
        select: { id: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (!policy) throw new ConflictException('An active cancellation policy is required');

      const now = new Date();
      await assertBookable(tx, tenantId, slot, now);
      const totalAmount = await this.pricing.quote(tx, tenantId, laneId, slot.startsAt, slot.endsAt);
      const depositRequired = new Prisma.Decimal(dto.depositRequired ?? 0);
      if (depositRequired.gt(totalAmount)) {
        throw new BadRequestException('The deposit cannot exceed the quoted total');
      }
      const hold = totalAmount.gt(0);
      if (hold && !idempotencyKey) requirePermission(principal, PermissionCode.CREATE_UNPAID_HOLD);
      const status = hold ? BookingStatus.HELD : BookingStatus.CONFIRMED;
      const holdExpiresAt = hold ? this.holdDeadline(tenant.unpaidHoldMinutes, slot.startsAt, now) : null;

      let booking = await tx.booking.create({
        data: {
          tenantId,
          customerId: customer.id,
          creatorId: userId,
          headcount: dto.headcount,
          leadOwnerId,
          leadSource,
          slotId: slot.id,
          cancellationPolicyId: policy.id,
          currency: tenant.currency,
          depositRequired,
          totalAmount,
          status,
          paymentStatus: hold ? BookingPaymentStatus.UNPAID : BookingPaymentStatus.FULLY_PAID,
          holdExpiresAt,
        },
      });

      if (idempotencyKey) {
        const amount = dto.initialPayment ? new Prisma.Decimal(dto.initialPayment.amount) : totalAmount;
        ({ booking } = await this.payments.applyCollection(tx, booking, principal, {
          amount, method, idempotencyKey,
        }, now));
      }
      return this.withStaffing(tx, booking, slot);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    this.availability.changed(tenantId);
    return result;
  }

  async reschedule(principal: AuthPrincipal, bookingId: string, dto: RescheduleBookingDto) {
    const { tenantId, userId } = principal;
    const destinationLaneId = await this.findSlotLane(tenantId, dto.slotId);
    const result = await withLockedBooking(this.prisma, tenantId, bookingId, [destinationLaneId], async (tx, booking) => {
      await assertCanManageBooking(tx, principal, booking);
      const now = new Date();
      assertUpcomingBooking(booking, now);

      const slot = await this.readSlot(tx, tenantId, dto.slotId, destinationLaneId);
      if (slot.id === booking.slotId) {
        return { ...await this.withStaffing(tx, booking, slot), tariffChange: new Prisma.Decimal(0) };
      }
      await assertBookable(tx, tenantId, slot, now, booking.id);
      const totalAmount = await this.pricing.quote(tx, tenantId, destinationLaneId, slot.startsAt, slot.endsAt);
      const invoice = await readInvoiceBalance(tx, booking);
      if (invoice && totalAmount.gt(booking.totalAmount)) {
        throw new ConflictException('An issued invoice cannot cover a higher-priced reschedule. Choose a slot at the same or lower rate.');
      }
      // Payments already accepted keep their lock even when the new tariff has a balance due.
      const depositRequired = booking.depositRequired.isZero()
        ? Prisma.Decimal.min(totalAmount, booking.amountPaid)
        : Prisma.Decimal.min(totalAmount, booking.depositRequired);
      const paymentStatus = paymentState(totalAmount, booking.amountPaid, depositRequired);

      let holdExpiresAt: Date | null = null;
      if (paymentStatus === BookingPaymentStatus.UNPAID) {
        if (booking.holdExpiresAt) {
          holdExpiresAt = new Date(Math.min(booking.holdExpiresAt.getTime(), slot.startsAt.getTime()));
        } else {
          requirePermission(principal, PermissionCode.CREATE_UNPAID_HOLD);
          const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
          holdExpiresAt = this.holdDeadline(tenant.unpaidHoldMinutes, slot.startsAt, now);
        }
      }

      const updated = await tx.booking.update({
        where: { tenantId_id: { tenantId, id: bookingId } },
        data: {
          slotId: slot.id,
          totalAmount,
          depositRequired,
          paymentStatus,
          holdExpiresAt,
          status: holdExpiresAt ? BookingStatus.HELD : BookingStatus.CONFIRMED,
        },
      });
      const adjustment = await tx.bookingReschedule.create({
        data: {
          tenantId,
          bookingId,
          previousSlotId: booking.slotId,
          newSlotId: slot.id,
          changedById: userId,
          previousTotal: booking.totalAmount,
          newTotal: totalAmount,
        },
      });
      if (invoice && totalAmount.lt(booking.totalAmount)) {
        const adjusted = Prisma.Decimal.max(0, invoice.netAmount.minus(booking.totalAmount.minus(totalAmount)));
        await creditInvoiceTo(tx, booking, adjusted, userId, 'Booking rescheduled at a lower rate', 'reschedule:' + adjustment.id);
      }
      const settled = await this.payments.returnWalletPayment(tx, principal, updated, 'reschedule:' + adjustment.id, now);
      return {
        ...await this.withStaffing(tx, settled, slot),
        tariffChange: totalAmount.minus(booking.totalAmount),
      };
    });
    this.availability.changed(tenantId);
    return result;
  }

  async cancel(principal: AuthPrincipal, bookingId: string, dto: CancelBookingDto) {
    const { tenantId, userId } = principal;
    if (dto.waiveFee) requirePermission(principal, PermissionCode.WAIVE_CANCELLATION_FEE);
    const result = await withLockedBooking(this.prisma, tenantId, bookingId, [], async (tx, booking) => {
      await assertCanManageBooking(tx, principal, booking);
      const now = new Date();
      assertUpcomingBooking(booking, now);

      const terms = await this.policies.cancellationTerms(
        tx, tenantId, booking.cancellationPolicyId, now, booking.slot.startsAt,
        booking.totalAmount, booking.amountPaid,
      );
      if (dto.creditWallet && !terms.allowWalletCredit) {
        throw new ConflictException('The cancellation policy does not allow wallet credit');
      }

      const cancellationFee = dto.waiveFee ? new Prisma.Decimal(0) : terms.fee;
      const cancelled = await tx.booking.update({
        where: { tenantId_id: { tenantId, id: bookingId } },
        data: {
          status: BookingStatus.CANCELLED,
          holdExpiresAt: null,
          cancellationFee,
          cancellationReason: dto.reason,
          cancelledAt: now,
          cancelledById: userId,
        },
      });
      await creditInvoiceTo(tx, booking, cancellationFee, userId, 'Booking cancelled', 'cancel:' + booking.id);
      const updated = await this.payments.returnWalletPayment(tx, principal, cancelled, 'cancel:' + cancelled.id, now);
      if (!dto.creditWallet || amountRefundable(updated).isZero()) return this.summary(updated);

      const ownsBooking = await tx.customer.count({
        where: { tenantId, id: booking.customerId, userId },
      });
      if (!ownsBooking) requirePermission(principal, PermissionCode.ISSUE_REFUND);
      return this.summary(await this.payments.creditCancellationBalance(tx, principal, updated, now));
    });
    this.availability.changed(tenantId);
    return result;
  }

  private visibleBookings(principal: AuthPrincipal): Prisma.BookingWhereInput {
    const staff = principal.permissions.has(PermissionCode.VIEW_BOOKINGS)
      || principal.permissions.has(PermissionCode.MANAGE_BOOKINGS);
    return {
      tenantId: principal.tenantId,
      customer: staff ? undefined : { userId: principal.userId },
    };
  }

  private async findSlotLane(tenantId: string, slotId: string) {
    const slot = await this.prisma.slotSchedule.findUnique({
      where: { tenantId_id: { tenantId, id: slotId } },
      select: { laneId: true },
    });
    if (!slot) throw new NotFoundException('Slot not found');
    return slot.laneId;
  }

  private createSlotIds(dto: CreateBookingDto) {
    if ((dto.slotId !== undefined) === (dto.slotIds !== undefined)) {
      throw new BadRequestException('Supply either slotId or slotIds');
    }
    const ids = dto.slotId === undefined ? dto.slotIds : [dto.slotId];
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 48
      || ids.some((id) => typeof id !== 'string')) {
      throw new BadRequestException('Select between 1 and 48 sessions');
    }
    const normalized = ids.map((id) => id.toLowerCase());
    if (new Set(normalized).size !== normalized.length) {
      throw new BadRequestException('A session cannot be selected more than once');
    }
    return normalized;
  }

  private async readCreateSlot(
    tx: Prisma.TransactionClient,
    tenantId: string,
    slotIds: string[],
    laneId: string,
  ): Promise<SlotDetails> {
    const slots = await tx.slotSchedule.findMany({
      where: { tenantId, id: { in: slotIds } },
      orderBy: [{ startsAt: 'asc' }, { endsAt: 'asc' }],
      ...slotDetails,
    });
    if (slots.length !== slotIds.length) {
      throw new NotFoundException('One or more selected sessions were not found');
    }
    for (const slot of slots) {
      if (slot.laneId !== laneId) {
        throw new BadRequestException('All selected sessions must use the same ground');
      }
      if (!slot.lane.isActive || !slot.lane.branch.isActive) {
        throw new ConflictException('The selected lane is not accepting bookings');
      }
      if (slot.isBookingRange || slot.kind !== SlotKind.BOOKABLE) {
        throw new BadRequestException('Select bookable sessions from the calendar');
      }
    }
    if (slots.length === 1) return slots[0];

    for (let index = 1; index < slots.length; index++) {
      if (slots[index - 1].endsAt.getTime() !== slots[index].startsAt.getTime()) {
        throw new BadRequestException('Selected sessions must be consecutive without gaps or overlaps');
      }
    }
    const startsAt = slots[0].startsAt;
    const endsAt = slots[slots.length - 1].endsAt;
    if (endsAt.getTime() - startsAt.getTime() > 24 * 60 * 60_000) {
      throw new BadRequestException('A booking cannot exceed 24 hours');
    }

    // The lane lock makes concurrent requests share one immutable range. Existing
    // catalog sessions with these exact endpoints are safe to reuse as well.
    return tx.slotSchedule.upsert({
      where: { tenantId_laneId_startsAt_endsAt_kind: { tenantId, laneId, startsAt, endsAt, kind: SlotKind.BOOKABLE } },
      create: { tenantId, laneId, startsAt, endsAt, kind: SlotKind.BOOKABLE, isBookingRange: true },
      update: {},
      ...slotDetails,
    });
  }

  private async readSlot(tx: Prisma.TransactionClient, tenantId: string, slotId: string, laneId: string) {
    const slot = await tx.slotSchedule.findUnique({
      where: { tenantId_id: { tenantId, id: slotId } },
      ...slotDetails,
    });
    if (!slot) throw new NotFoundException('Slot not found');
    if (slot.isBookingRange) {
      throw new BadRequestException('Select a session from the calendar');
    }
    if (slot.laneId !== laneId || !slot.lane.isActive || !slot.lane.branch.isActive) {
      throw new ConflictException('The selected lane is not accepting bookings');
    }
    return slot;
  }

  private holdDeadline(minutes: number, startsAt: Date, now: Date) {
    if (minutes < 1) throw new ConflictException('The tenant must configure an unpaid hold duration');
    return new Date(Math.min(startsAt.getTime(), now.getTime() + minutes * 60_000));
  }

  private summary<T extends Booking>(booking: T) {
    return {
      ...booking,
      balanceDue: booking.status === BookingStatus.CANCELLED
        ? new Prisma.Decimal(0)
        : Prisma.Decimal.max(0, booking.totalAmount.minus(booking.amountPaid)),
      refundableAmount: amountRefundable(booking),
    };
  }

  private async withStaffing(tx: Prisma.TransactionClient, booking: Booking, slot: SlotDetails) {
    const isStaffed = await this.roster.isStaffed(
      tx, booking.tenantId, slot.lane.branchId, slot.startsAt, slot.endsAt,
    );
    const { laneId, startsAt, endsAt } = slot;
    return {
      ...this.summary(booking),
      slot: { laneId, startsAt, endsAt, laneName: slot.lane.name, timeZone: slot.lane.branch.timeZone },
      unstaffed: !isStaffed,
    };
  }
}
