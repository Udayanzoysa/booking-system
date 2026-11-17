import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { BookingStatus } from '@prisma/client';
import { AvailabilityEvents } from '../availability/availability.events';
import { PrismaService } from '../prisma/prisma.service';
import { withLockedBooking } from './booking-lock';

@Injectable()
export class BookingExpiry implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BookingExpiry.name);
  private timer?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityEvents,
  ) {}

  onModuleInit() {
    this.schedule(0);
  }

  onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private schedule(delay: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.sweep(), delay);
    this.timer.unref();
  }

  private async sweep() {
    const changedTenants = new Set<string>();
    let nextDelay = 15_000;

    try {
      const now = new Date();
      const holds = await this.prisma.booking.findMany({
        where: { status: BookingStatus.HELD, holdExpiresAt: { lte: now } },
        select: { id: true, tenantId: true },
        orderBy: { holdExpiresAt: 'asc' },
        take: 100,
      });
      for (const { tenantId, id } of holds) {
        if (this.stopped) break;
        const expired = await withLockedBooking(this.prisma, tenantId, id, [], async (tx) => (
          tx.booking.updateMany({
            where: { tenantId, id, status: BookingStatus.HELD, holdExpiresAt: { lte: now } },
            data: { status: BookingStatus.EXPIRED },
          })
        ));
        if (expired.count) changedTenants.add(tenantId);
      }
      if (holds.length === 100) nextDelay = 0;
    } catch (error) {
      this.logger.warn(error instanceof Error ? error.message : 'Unpaid hold expiry failed');
    } finally {
      for (const tenantId of changedTenants) this.availability.changed(tenantId);
      this.schedule(nextDelay);
    }
  }
}
