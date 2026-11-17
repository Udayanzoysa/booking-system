import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  BookingPaymentStatus,
  BookingStatus,
  PaymentMethod,
  PaymentTransactionStatus,
  PaymentTransactionType,
  Prisma,
  type Booking,
  type PaymentTransaction,
} from '@prisma/client';
import { AvailabilityEvents } from '../availability/availability.events';
import type { AuthPrincipal } from '../auth/auth-principal';
import { assertBookable } from '../bookings/booking-availability';
import { withLockedBooking } from '../bookings/booking-lock';
import { amountRefundable, assertOwner, assertUpcomingBooking, paymentState } from '../bookings/booking-state';
import { PrismaService } from '../prisma/prisma.service';
import { invoicePayableAmount } from '../invoices/invoice-balance';
import { ManualPaymentDto, WalletCollectionDto } from './payments.dto';

interface Collection {
  idempotencyKey: string;
  amount: Prisma.Decimal;
  method: PaymentMethod;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityEvents,
  ) {}

  recordCollection(principal: AuthPrincipal, bookingId: string, dto: ManualPaymentDto) {
    return this.collect(principal, bookingId, dto, dto.method);
  }

  recordInvoiceCollection(principal: AuthPrincipal, bookingId: string, dto: ManualPaymentDto) {
    return this.collect(principal, bookingId, dto, dto.method, true);
  }

  payFromWallet(principal: AuthPrincipal, bookingId: string, dto: WalletCollectionDto) {
    return this.collect(principal, bookingId, dto, PaymentMethod.WALLET);
  }

  async applyCollection(
    tx: Prisma.TransactionClient,
    booking: Booking,
    principal: AuthPrincipal,
    collection: Collection,
    now: Date,
    preserveStatus = false,
  ) {
    const { amount, method, idempotencyKey } = collection;
    const amountPaid = booking.amountPaid.plus(amount);
    const payable = await invoicePayableAmount(tx, booking);
    if (amount.lte(0) || amountPaid.gt(payable)) {
      throw new BadRequestException('Payment must be positive and cannot exceed the remaining balance');
    }

    const paymentStatus = paymentState(payable, amountPaid, Prisma.Decimal.min(payable, booking.depositRequired));
    if (!preserveStatus && paymentStatus === BookingPaymentStatus.UNPAID) {
      throw new BadRequestException('Payment must satisfy the configured deposit or pay the total in full');
    }

    if (method === PaymentMethod.WALLET) {
      const debited = await tx.customer.updateMany({
        where: {
          tenantId: booking.tenantId,
          id: booking.customerId,
          walletBalance: { gte: amount },
        },
        data: { walletBalance: { decrement: amount } },
      });
      if (debited.count === 0) throw new ConflictException('The customer wallet has insufficient funds');
    }

    const transaction = await this.record(tx, booking, principal, {
      amount, idempotencyKey, method, type: PaymentTransactionType.COLLECTION,
    }, now);
    const updated = await tx.booking.update({
      where: { tenantId_id: { tenantId: booking.tenantId, id: booking.id } },
      data: {
        amountPaid, paymentStatus,
        status: preserveStatus ? undefined : BookingStatus.CONFIRMED,
        holdExpiresAt: preserveStatus ? undefined : null,
      },
    });

    return { booking: updated, transaction };
  }

  async recordRefund(principal: AuthPrincipal, bookingId: string, dto: ManualPaymentDto) {
    return withLockedBooking(this.prisma, principal.tenantId, bookingId, [], async (tx, booking) => {
      const type = PaymentTransactionType.REFUND;
      const amount = new Prisma.Decimal(dto.amount);
      const key = dto.idempotencyKey.toLowerCase();
      const replay = await this.findReplay(tx, booking, key, amount, dto.method, type);
      if (replay) return { booking, transaction: replay };
      const payable = await invoicePayableAmount(tx, booking);
      if (amount.lte(0) || amount.gt(booking.amountPaid.minus(payable))) {
        throw new BadRequestException('Refund must be positive and cannot exceed the refundable balance');
      }

      // Verify the external payment method has captured funds to return.
      if ((await this.remainingOriginBalance(tx, booking, dto.method)).lt(amount)) {
        throw new BadRequestException('The original payment method has insufficient refundable funds');
      }

      const transaction = await this.record(tx, booking, principal, {
        amount, type, method: dto.method, idempotencyKey: key,
      }, new Date());
      return { booking: await this.applyRefund(tx, booking, amount), transaction };
    });
  }

  async returnWalletPayment(
    tx: Prisma.TransactionClient,
    principal: AuthPrincipal,
    booking: Booking,
    operationId: string,
    now: Date,
  ) {
    const refundable = amountRefundable(booking);
    if (refundable.isZero()) return booking;
    const walletPaid = await this.remainingOriginBalance(tx, booking, PaymentMethod.WALLET);
    const amount = Prisma.Decimal.min(walletPaid, refundable);
    return this.creditWallet(tx, principal, booking, {
      amount,
      type: PaymentTransactionType.REFUND,
      idempotencyKey: 'wallet-refund:' + operationId,
    }, now);
  }

  creditCancellationBalance(tx: Prisma.TransactionClient, principal: AuthPrincipal, booking: Booking, now: Date) {
    return this.creditWallet(tx, principal, booking, {
      amount: amountRefundable(booking),
      type: PaymentTransactionType.WALLET_CREDIT,
      idempotencyKey: 'wallet-credit:' + booking.id,
    }, now);
  }

  private async creditWallet(
    tx: Prisma.TransactionClient,
    principal: AuthPrincipal,
    booking: Booking,
    credit: Pick<PaymentTransaction, 'amount' | 'idempotencyKey' | 'type'>,
    now: Date,
  ) {
    if (credit.amount.lte(0)) return booking;

    await tx.customer.update({
      where: { tenantId_id: { tenantId: booking.tenantId, id: booking.customerId } },
      data: { walletBalance: { increment: credit.amount } },
    });
    await this.record(tx, booking, principal, {
      ...credit,
      method: PaymentMethod.WALLET,
    }, now);
    return this.applyRefund(tx, booking, credit.amount);
  }

  private async remainingOriginBalance(tx: Prisma.TransactionClient, booking: Booking, method: PaymentMethod) {
    const settlements = await tx.paymentTransaction.groupBy({
      by: ['type'],
      where: {
        tenantId: booking.tenantId,
        bookingId: booking.id,
        status: PaymentTransactionStatus.SUCCEEDED,
        method,
        type: { in: [PaymentTransactionType.COLLECTION, PaymentTransactionType.REFUND] },
      },
      _sum: { amount: true },
    });
    const collected = settlements.find((item) => item.type === PaymentTransactionType.COLLECTION)?._sum.amount;
    const refunded = settlements.find((item) => item.type === PaymentTransactionType.REFUND)?._sum.amount;
    return (collected ?? new Prisma.Decimal(0)).minus(refunded ?? 0);
  }

  private async collect(
    principal: AuthPrincipal,
    bookingId: string,
    dto: WalletCollectionDto,
    method: PaymentMethod,
    invoiceSettlement = false,
  ) {
    const result = await withLockedBooking(this.prisma, principal.tenantId, bookingId, [], async (tx, booking) => {
      if (method === PaymentMethod.WALLET) await assertOwner(tx, principal, booking);
      const amount = new Prisma.Decimal(dto.amount);
      const key = dto.idempotencyKey.toLowerCase();
      const replay = await this.findReplay(
        tx, booking, key, amount, method, PaymentTransactionType.COLLECTION,
      );
      if (replay) return { booking, transaction: replay };

      const now = new Date();
      if (invoiceSettlement) {
        if (booking.status === BookingStatus.HELD || booking.status === BookingStatus.EXPIRED) {
          throw new ConflictException('Tentative or expired holds cannot be settled through an invoice');
        }
      } else {
        assertUpcomingBooking(booking, now);
        await assertBookable(tx, principal.tenantId, booking.slot, now, booking.id);
      }
      return this.applyCollection(tx, booking, principal, { amount, idempotencyKey: key, method }, now, invoiceSettlement);
    });
    this.availability.changed(principal.tenantId);
    return result;
  }

  private async findReplay(
    tx: Prisma.TransactionClient,
    booking: Booking,
    idempotencyKey: string,
    amount: Prisma.Decimal,
    method: PaymentMethod,
    type: PaymentTransactionType,
  ) {
    const entry = await tx.paymentTransaction.findUnique({
      where: { tenantId_idempotencyKey: { tenantId: booking.tenantId, idempotencyKey } },
    });
    if (!entry) return null;
    if (entry.bookingId !== booking.id || entry.type !== type || entry.method !== method || !entry.amount.eq(amount)) {
      throw new ConflictException('The idempotency key is already used for another payment operation');
    }
    return entry;
  }

  private async applyRefund(tx: Prisma.TransactionClient, booking: Booking, amount: Prisma.Decimal) {
    const amountPaid = booking.amountPaid.minus(amount);
    const payable = await invoicePayableAmount(tx, booking);
    return tx.booking.update({
      where: { tenantId_id: { tenantId: booking.tenantId, id: booking.id } },
      data: {
        amountPaid,
        paymentStatus: paymentState(payable, amountPaid, Prisma.Decimal.min(payable, booking.depositRequired)),
      },
    });
  }

  private record(
    tx: Prisma.TransactionClient,
    booking: Booking,
    principal: AuthPrincipal,
    data: Pick<PaymentTransaction, 'amount' | 'idempotencyKey' | 'method' | 'type'>,
    now: Date,
  ) {
    return tx.paymentTransaction.create({
      data: {
        ...data,
        tenantId: booking.tenantId,
        bookingId: booking.id,
        currency: booking.currency,
        recordedById: principal.userId,
        status: PaymentTransactionStatus.SUCCEEDED,
        processedAt: now,
      },
    });
  }
}
