import { ConflictException } from '@nestjs/common';
import { Prisma, SlotKind, type SlotSchedule } from '@prisma/client';
import { blockingBookingAt } from '../lanes/availability';

export async function assertBookable(
  tx: Prisma.TransactionClient,
  tenantId: string,
  slot: SlotSchedule,
  now: Date,
  excludingBookingId?: string,
) {
  if (slot.kind !== SlotKind.BOOKABLE || slot.startsAt <= now) {
    throw new ConflictException('The selected slot is not bookable');
  }

  const conflict = await tx.slotSchedule.findFirst({
    where: {
      tenantId,
      laneId: slot.laneId,
      startsAt: { lt: slot.endsAt },
      endsAt: { gt: slot.startsAt },
      OR: [
        { kind: SlotKind.MAINTENANCE },
        {
          bookings: {
            some: {
              tenantId,
              id: excludingBookingId ? { not: excludingBookingId } : undefined,
              ...blockingBookingAt(now),
            },
          },
        },
      ],
    },
    select: { id: true },
  });

  if (conflict) {
    throw new ConflictException('The selected lane is unavailable for this time');
  }
}
