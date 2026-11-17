import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { BookingStatus, PaymentTransactionStatus, Prisma } from '@prisma/client';
import type { AuthPrincipal } from '../auth/auth-principal';
import { withLockedBooking } from '../bookings/booking-lock';
import { ManualPaymentDto } from '../payments/payments.dto';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionCode } from '../rbac/permissions';
import { bookingLiability, nextInvoiceNumber } from './invoice-balance';
import { InvoiceListDto, IssueCreditNoteDto } from './invoices.dto';

const details = {
  creditNotes: { orderBy: { number: 'asc' } },
  booking: { select: {
    status: true, totalAmount: true, amountPaid: true, cancellationFee: true,
    payments: {
      where: { status: PaymentTransactionStatus.SUCCEEDED },
      orderBy: { createdAt: 'asc' },
      select: { id: true, amount: true, processedAt: true, method: true, type: true },
    },
  } },
} satisfies Prisma.InvoiceInclude;

function serialize(row: Prisma.InvoiceGetPayload<{include: typeof details}>) {
  const { booking, creditNotes, ...invoice } = row;
  const credited = creditNotes.reduce((sum, note) => sum.plus(note.amount), new Prisma.Decimal(0));
  const netAmount = invoice.totalAmount.minus(credited);
  const payable = Prisma.Decimal.min(netAmount, bookingLiability(booking));
  const amountDue = Prisma.Decimal.max(0, payable.minus(booking.amountPaid));
  return { ...invoice, creditNotes, credited, netAmount, payable, amountPaid: booking.amountPaid,
    amountDue, overpaid: Prisma.Decimal.max(0, booking.amountPaid.minus(payable)),
    settlementStatus: amountDue.isZero() ? 'SETTLED' : booking.amountPaid.isZero() ? 'UNPAID' : 'PARTIAL',
    bookingStatus: booking.status, transactions: booking.payments };
}

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService, private readonly payments: PaymentsService) {}

  private visible(user: AuthPrincipal): Prisma.InvoiceWhereInput {
    return {
      tenantId: user.tenantId,
      customer: user.permissions.has(PermissionCode.MANAGE_INVOICES) ? undefined : { userId: user.userId },
    };
  }

  private visibleBookingInvoice(user: AuthPrincipal): Prisma.InvoiceWhereInput {
    if (user.permissions.has(PermissionCode.VIEW_BOOKINGS) || user.permissions.has(PermissionCode.MANAGE_BOOKINGS)) {
      return { tenantId: user.tenantId };
    }
    return this.visible(user);
  }

  async forBooking(user: AuthPrincipal, bookingId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { ...this.visibleBookingInvoice(user), bookingId },
      select: { id: true },
    });
    return { invoiceId: invoice?.id ?? null };
  }

  async list(user: AuthPrincipal, query: InvoiceListDto) {
    const before = query.before === undefined ? undefined : Number(query.before);
    if (before !== undefined && (before < 1 || before > 2147483647)) throw new BadRequestException('Invalid invoice cursor');
    if (query.startsAt && query.endsAt && Date.parse(query.startsAt) >= Date.parse(query.endsAt)) {
      throw new BadRequestException('End date must follow start date');
    }
    const rows = await this.prisma.invoice.findMany({
      where: {
        ...this.visible(user), branchId: query.branchId, customerId: query.customerId,
        number: before === undefined ? undefined : { lt: before },
        issuedAt: { gte: query.startsAt, lt: query.endsAt },
      },
      orderBy: { number: 'desc' },
      take: 31,
      include: details,
    });
    const invoices = rows.slice(0, 30).map(serialize);
    return { invoices, nextCursor: rows.length > 30 ? String(invoices[29].number) : null };
  }

  async get(user: AuthPrincipal, id: string) {
    const invoice = await this.prisma.invoice.findFirstOrThrow({
      where: { ...this.visibleBookingInvoice(user), id }, include: details,
    });
    const staff = user.permissions.has(PermissionCode.VIEW_BOOKINGS) || user.permissions.has(PermissionCode.MANAGE_BOOKINGS);
    if (staff && !user.permissions.has(PermissionCode.MANAGE_INVOICES) && !user.permissions.has(PermissionCode.MANAGE_CUSTOMERS)) {
      invoice.customerEmail = null;
    }
    return serialize(invoice);
  }

  async issue(user: AuthPrincipal, bookingId: string) {
    const { tenantId } = user;
    const id = await withLockedBooking(this.prisma, tenantId, bookingId, [], async (tx, booking) => {
      const existing = await tx.invoice.findUnique({
        where: { tenantId_bookingId: { tenantId, bookingId } }, select: { id: true },
      });
      if (existing) return existing.id;
      if (booking.status !== BookingStatus.CONFIRMED && booking.status !== BookingStatus.COMPLETED) {
        throw new ConflictException('Only confirmed or completed bookings can be invoiced');
      }
      const customer = await tx.customer.findUniqueOrThrow({
        where: { tenantId_id: { tenantId, id: booking.customerId } },
      });
      const lane = await tx.lane.findUniqueOrThrow({
        where: { tenantId_id: { tenantId, id: booking.slot.laneId } },
        include: { branch: { include: { tenant: { select: { name: true } } } } },
      });
      const number = await nextInvoiceNumber(tx, tenantId);
      const invoice = await tx.invoice.create({ data: {
        tenantId, bookingId, branchId: lane.branchId, customerId: customer.id, issuedById: user.userId,
        number, customerName: customer.name, customerEmail: customer.email, issuerName: lane.branch.tenant.name,
        branchName: lane.branch.name, branchTimeZone: lane.branch.timeZone, laneName: lane.name,
        serviceStartsAt: booking.slot.startsAt, serviceEndsAt: booking.slot.endsAt,
        currency: booking.currency, totalAmount: booking.totalAmount,
      }, select: { id: true } });
      return invoice.id;
    });
    return this.get(user, id);
  }

  async credit(user: AuthPrincipal, id: string, dto: IssueCreditNoteDto) {
    const { tenantId } = user;
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { tenantId_id: { tenantId, id } } });
    const key = dto.idempotencyKey.toLowerCase();
    const amount = new Prisma.Decimal(dto.amount);
    const reason = dto.reason.trim();
    await withLockedBooking(this.prisma, tenantId, invoice.bookingId, [], async (tx) => {
      const replay = await tx.invoiceCreditNote.findUnique({
        where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: key } },
      });
      if (replay) {
        if (replay.invoiceId !== id || !replay.amount.eq(amount) || replay.reason !== reason) {
          throw new ConflictException('The retry key is already used for a different credit note');
        }
        return;
      }
      const { _sum } = await tx.invoiceCreditNote.aggregate({ where: { tenantId, invoiceId: id }, _sum: { amount: true } });
      if (amount.lte(0) || amount.gt(invoice.totalAmount.minus(_sum.amount ?? 0))) {
        throw new BadRequestException('Credit must be positive and within the uncredited invoice total');
      }
      await tx.invoiceCreditNote.create({ data: {
        tenantId, invoiceId: id, number: await nextInvoiceNumber(tx, tenantId), issuedById: user.userId,
        amount, reason, idempotencyKey: key,
      } });
    });
    return this.get(user, id);
  }

  async collect(user: AuthPrincipal, id: string, dto: ManualPaymentDto) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { tenantId_id: { tenantId: user.tenantId, id } }, select: { bookingId: true },
    });
    await this.payments.recordInvoiceCollection(user, invoice.bookingId, dto);
    return this.get(user, id);
  }

}

