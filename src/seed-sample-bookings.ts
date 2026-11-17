import 'reflect-metadata';
import { createHash } from 'node:crypto';
import {
  BookingPaymentStatus, BookingStatus, CancellationFeeType, DayOfWeek, LaneType, LeadSource,
  PaymentMethod, PaymentTransactionStatus, PaymentTransactionType, PricingTier, Prisma, PrismaClient,
} from '@prisma/client';
import { hashPassword } from './auth/password';
import { requireSampleDatabase } from './sample-database';

const tenantSlug = 'techwing-auth-sample';
const password = 'Techwing-Local-Test-2026!';
const hour = 3600_000;
const day = 24 * hour;
const offset = 5.5 * hour;
const invoiceCount = 1000;
const customerCount = 100;
const futureCount = 120;
const sources = [LeadSource.PHONE, LeadSource.WHATSAPP, LeadSource.WALK_IN];
const laneNames = ['Turf Net 1', 'Turf Net 2', 'Bowling Machine 1', 'Bowling Machine 2'];

function fixtureId(tenantId: string, table: string, index: number): string {
  const hash = createHash('sha256').update([tenantId, 'booking-samples-v1', table, index].join('/')).digest('hex');
  return hash.replace(/^(.{8})(.{4}).(.{3}).(.{3})(.{12}).*$/, '$1-$2-4$3-a$4-$5');
}

function localTime(midnight: number, dayOffset: number, hours: number): Date {
  return new Date(midnight + dayOffset * day + hours * hour);
}

async function seed() {
  requireSampleDatabase();
  const prisma = new PrismaClient();
  const passwordHash = await hashPassword(password);
  try {
    await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { slug: tenantSlug } });
      const tenantId = tenant.id;
      // Serialize reruns and keep invoice number allocation atomic.
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId}::uuid FOR UPDATE`;
      const id = (table: string, index: number) => fixtureId(tenantId, table, index);
      const admin = await tx.user.findUniqueOrThrow({ where: { tenantId_email: { tenantId, email: 'admin@example.test' } } });
      const role = await tx.role.findUniqueOrThrow({ where: { tenantId_name: { tenantId, name: 'Booking Staff' } } });
      const staff = await tx.user.findMany({
        where: { tenantId, email: { in: ['nimal@example.test', 'kamal@example.test'] } },
      });
      for (const [index, displayName] of ['Nimal', 'Kamal'].entries()) {
        const email = displayName.toLowerCase() + '@example.test';
        const previous = staff.find((user) => user.email === email);
        if (previous) {
          if (previous.id !== id('staff', index)) throw new Error('A sample staff email is already in use.');
          continue;
        }
        const user = await tx.user.create({ data: { id: id('staff', index), tenantId, email, displayName, passwordHash } });
        await tx.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id } });
      }

      const exists = await tx.booking.findUnique({ where: { tenantId_id: { tenantId, id: id('booking', 0) } } });
      if (exists) return;

      const branch = await tx.branch.create({ data: {
        tenantId, code: 'sample-volume', name: 'Sample Training Arena', timeZone: 'Asia/Colombo', webLeadOwnerId: admin.id,
      } });
      const policy = await tx.cancellationPolicy.create({ data: {
        tenantId, name: 'Sample training cancellation', allowWalletCredit: true,
        tiers: { create: [
          { minimumNoticeMinutes: 0, feeType: CancellationFeeType.FORFEIT_PAID_AMOUNT },
          { minimumNoticeMinutes: 360, feeType: CancellationFeeType.PERCENT_OF_BOOKING_TOTAL, feeValue: 25 },
          { minimumNoticeMinutes: 1440, minimumInclusive: false, feeType: CancellationFeeType.FREE },
        ] },
      } });
      const lanes = await tx.lane.createManyAndReturn({ data: laneNames.map((name, index) => ({
        id: id('lane', index), tenantId, branchId: branch.id, name, type: index < 2 ? LaneType.TURF_NET : LaneType.BOWLING_MACHINE,
      })) });
      const orderedLanes = laneNames.map((name) => lanes.find((lane) => lane.name === name)!);
      await tx.lanePricingRule.createMany({ data: orderedLanes.flatMap((lane, index) => Object.values(DayOfWeek).map((dayOfWeek) => ({
        tenantId, laneId: lane.id, dayOfWeek, startMinute: 0, endMinute: 1440,
        tier: PricingTier.OFF_PEAK, pricePerHour: index < 2 ? 3000 : 4500,
      }))) });
      await tx.customer.createMany({ data: Array.from({ length: customerCount }, (_, index) => {
        const number = String(index + 1).padStart(3, '0');
        return { id: id('customer', index), tenantId, name: 'Training Customer ' + number, email: 'customer' + number + '@example.test' };
      }) });

      const now = Date.now();
      const midnight = Math.floor((now + offset) / day) * day - offset;
      const firstTodayHour = Math.ceil((now - midnight + hour) / hour);
      const historyCount = invoiceCount - futureCount;
      const slots: Prisma.SlotScheduleCreateManyInput[] = [];
      const bookings: Prisma.BookingCreateManyInput[] = [];
      const payments: Prisma.PaymentTransactionCreateManyInput[] = [];
      const invoices: Prisma.InvoiceCreateManyInput[] = [];
      const [sequence] = await tx.$queryRaw<{ nextNumber: number }[]>`
        INSERT INTO "InvoiceSequence" ("tenantId", "nextNumber") VALUES (${tenantId}::uuid, ${invoiceCount + 1})
        ON CONFLICT ("tenantId") DO UPDATE SET "nextNumber" = "InvoiceSequence"."nextNumber" + ${invoiceCount}
        RETURNING "nextNumber"
      `;
      const firstNumber = sequence.nextNumber - invoiceCount;
      for (let index = 0; index < invoiceCount; index++) {
        const historical = index < historyCount;
        const position = historical ? index : index - historyCount;
        const laneIndex = position % orderedLanes.length;
        const lane = orderedLanes[laneIndex];
        const period = Math.floor(position / orderedLanes.length);
        const startsAt = historical
          ? localTime(midnight, -1 - Math.floor(period / 12), 8 + period % 12)
          : new Date(midnight + (firstTodayHour + Math.floor(period / 6) * 24 + period % 6) * hour);
        const endsAt = new Date(startsAt.getTime() + hour);
        const bookingId = id('booking', index);
        const slotId = id('slot', index);
        const owner = id('staff', index % 2);
        const customerIndex = (index + Math.floor(index / customerCount)) % customerCount;
        const customerNumber = String(customerIndex + 1).padStart(3, '0');
        const totalAmount = laneIndex < 2 ? 3000 : 4500;
        const variant = index % 10;
        const amountPaid = variant < 4 ? totalAmount : variant < 7 ? 1000 : 0;
        const at = new Date(Math.min(startsAt.getTime() - day, now - 60_000));
        slots.push({ id: slotId, tenantId, laneId: lane.id, startsAt, endsAt });
        bookings.push({
          id: bookingId, tenantId, customerId: id('customer', customerIndex), slotId, cancellationPolicyId: policy.id,
          creatorId: owner, leadOwnerId: owner, leadSource: sources[index % sources.length], headcount: 2 + index % 9,
          status: historical ? BookingStatus.COMPLETED : BookingStatus.CONFIRMED,
          paymentStatus: variant < 4 ? BookingPaymentStatus.FULLY_PAID : variant < 7 ? BookingPaymentStatus.DEPOSIT_PAID : BookingPaymentStatus.UNPAID,
          currency: tenant.currency, totalAmount, amountPaid, depositRequired: variant >= 4 && variant < 7 ? 1000 : 0,
          createdAt: at,
        });
        if (amountPaid) payments.push({
          tenantId, bookingId, recordedById: owner, type: PaymentTransactionType.COLLECTION,
          status: PaymentTransactionStatus.SUCCEEDED, method: variant % 2 ? PaymentMethod.CARD : PaymentMethod.CASH,
          amount: amountPaid, currency: tenant.currency, idempotencyKey: 'sample-collection:' + bookingId,
          processedAt: at, createdAt: at,
        });
        invoices.push({
          id: id('invoice', index), tenantId, bookingId, customerId: id('customer', customerIndex),
          branchId: branch.id, issuedById: admin.id, number: firstNumber + index,
          customerName: 'Training Customer ' + customerNumber, customerEmail: 'customer' + customerNumber + '@example.test',
          issuerName: tenant.name, branchName: branch.name, branchTimeZone: branch.timeZone, laneName: lane.name,
          serviceStartsAt: startsAt, serviceEndsAt: endsAt, currency: tenant.currency, totalAmount, issuedAt: at,
        });
      }

      for (const lane of orderedLanes) {
        for (let date = 0; date < 7; date++) {
          const start = midnight + (firstTodayHour + 6) * hour + date * day;
          for (let period = 0; period < 3; period++) {
            slots.push({ tenantId, laneId: lane.id, startsAt: new Date(start + period * hour), endsAt: new Date(start + (period + 1) * hour) });
          }
        }
      }
      await tx.slotSchedule.createMany({ data: slots });
      await tx.booking.createMany({ data: bookings });
      await tx.paymentTransaction.createMany({ data: payments });
      await tx.invoice.createMany({ data: invoices });
    }, { timeout: 30_000 });
    console.log('Sample arena ready. Nimal and Kamal, 100 training customers, 1,000 bookings, and 1,000 invoices.');
  } finally {
    await prisma.$disconnect();
  }
}

void seed().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Sample booking creation failed.');
  process.exitCode = 1;
});

