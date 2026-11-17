import { BookingStatus, Prisma, type Booking } from '@prisma/client';

export function bookingLiability(booking: Pick<Booking, 'status' | 'totalAmount' | 'cancellationFee'>) {
  if (booking.status === BookingStatus.CANCELLED) return booking.cancellationFee ?? new Prisma.Decimal(0);
  if (booking.status === BookingStatus.EXPIRED) return new Prisma.Decimal(0);
  return booking.totalAmount;
}

export async function invoicePayableAmount(tx: Prisma.TransactionClient, booking: Booking) {
  const invoice = await readInvoiceBalance(tx, booking);
  return invoice ? Prisma.Decimal.min(bookingLiability(booking), invoice.netAmount) : bookingLiability(booking);
}

export async function readInvoiceBalance(tx: Prisma.TransactionClient, booking: Booking) {
  const invoice = await tx.invoice.findUnique({
    where: { tenantId_bookingId: { tenantId: booking.tenantId, bookingId: booking.id } },
    select: { id: true, totalAmount: true },
  });
  if (!invoice) return null;
  const { _sum } = await tx.invoiceCreditNote.aggregate({
    where: { tenantId: booking.tenantId, invoiceId: invoice.id },
    _sum: { amount: true },
  });
  return { id: invoice.id, netAmount: invoice.totalAmount.minus(_sum.amount ?? 0) };
}

export async function nextInvoiceNumber(tx: Prisma.TransactionClient, tenantId: string) {
  const [sequence] = await tx.$queryRaw<{ nextNumber: number }[]>`
    INSERT INTO "InvoiceSequence" ("tenantId", "nextNumber") VALUES (${tenantId}::uuid, 2)
    ON CONFLICT ("tenantId") DO UPDATE SET "nextNumber" = "InvoiceSequence"."nextNumber" + 1
    RETURNING "nextNumber"
  `;
  return sequence.nextNumber - 1;
}

export async function creditInvoiceTo(
  tx: Prisma.TransactionClient, booking: Booking, amountDue: Prisma.Decimal, userId: string,
  reason: string, idempotencyKey: string,
) {
  const invoice = await readInvoiceBalance(tx, booking);
  if (!invoice || invoice.netAmount.lte(amountDue)) return;
  await tx.invoiceCreditNote.create({ data: {
    tenantId: booking.tenantId, invoiceId: invoice.id, issuedById: userId,
    amount: invoice.netAmount.minus(amountDue), reason, idempotencyKey,
    number: await nextInvoiceNumber(tx, booking.tenantId),
  } });
}

