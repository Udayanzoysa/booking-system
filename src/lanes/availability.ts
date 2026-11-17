import { BookingStatus, Prisma } from '@prisma/client';

export function blockingBookingAt(asOf: Date): Prisma.BookingWhereInput {
  return {
    OR: [
      { status: BookingStatus.CONFIRMED },
      { status: BookingStatus.HELD, holdExpiresAt: { gt: asOf } },
    ],
  };
}
