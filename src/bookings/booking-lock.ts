import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { lockLanes } from '../prisma/lane-lock';
import { PrismaService } from '../prisma/prisma.service';

const bookingWithSlot = { include: { slot: true } } satisfies Prisma.BookingDefaultArgs;
export type BookingWithSlot = Prisma.BookingGetPayload<typeof bookingWithSlot>;

class BookingMoved extends Error {}

export async function withLockedBooking<T>(
  prisma: PrismaService,
  tenantId: string,
  bookingId: string,
  additionalLaneIds: string[],
  action: (tx: Prisma.TransactionClient, booking: BookingWithSlot) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const where = { tenantId_id: { tenantId, id: bookingId } };
        const beforeLock = await tx.booking.findUnique({
          where,
          select: { slot: { select: { laneId: true } } },
        });
        if (!beforeLock) throw new NotFoundException('Booking not found');

        await lockLanes(tx, tenantId, [beforeLock.slot.laneId, ...additionalLaneIds]);

        const booking = await tx.booking.findUnique({ where, ...bookingWithSlot });
        if (!booking) throw new NotFoundException('Booking not found');
        if (booking.slot.laneId !== beforeLock.slot.laneId) throw new BookingMoved();
        return action(tx, booking);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (!(error instanceof BookingMoved)) throw error;
    }
  }
  throw new ConflictException('The booking moved while it was being updated. Retry the request');
}
