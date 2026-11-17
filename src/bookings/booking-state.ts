import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BookingPaymentStatus, BookingStatus, Prisma, type Booking } from '@prisma/client';
import type { AuthPrincipal } from '../auth/auth-principal';
import { PermissionCode } from '../rbac/permissions';
import type { BookingWithSlot } from './booking-lock';

export function requirePermission(principal: AuthPrincipal, permission: string) {
  if (!principal.permissions.has(permission)) {
    throw new ForbiddenException('Missing required permission');
  }
}

export async function assertOwner(
  tx: Prisma.TransactionClient,
  principal: AuthPrincipal,
  booking: Booking,
) {
  const owner = await tx.customer.findFirst({
    where: { id: booking.customerId, tenantId: principal.tenantId, userId: principal.userId },
    select: { id: true },
  });
  if (!owner) throw new NotFoundException('Booking not found');
}

export async function assertCanManageBooking(
  tx: Prisma.TransactionClient,
  principal: AuthPrincipal,
  booking: Booking,
) {
  if (!principal.permissions.has(PermissionCode.MANAGE_BOOKINGS)) {
    await assertOwner(tx, principal, booking);
  }
}

export function assertUpcomingBooking(booking: BookingWithSlot, now: Date) {
  const activeHold = booking.status === BookingStatus.HELD
    && booking.holdExpiresAt !== null
    && booking.holdExpiresAt > now;
  if (booking.slot.startsAt <= now || (booking.status !== BookingStatus.CONFIRMED && !activeHold)) {
    throw new ConflictException('The booking is no longer active and upcoming');
  }
}

export function paymentState(
  total: Prisma.Decimal,
  paid: Prisma.Decimal,
  deposit: Prisma.Decimal,
): BookingPaymentStatus {
  if (paid.gte(total)) return BookingPaymentStatus.FULLY_PAID;
  if (deposit.gt(0) && paid.gte(deposit)) return BookingPaymentStatus.DEPOSIT_PAID;
  return BookingPaymentStatus.UNPAID;
}

export function amountRefundable(booking: Booking) {
  const amountRetained = booking.status === BookingStatus.CANCELLED
    ? booking.cancellationFee ?? booking.amountPaid
    : booking.totalAmount;
  return Prisma.Decimal.max(0, booking.amountPaid.minus(amountRetained));
}
