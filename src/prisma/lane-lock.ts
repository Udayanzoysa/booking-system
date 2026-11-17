import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export async function lockLanes(
  tx: Prisma.TransactionClient,
  tenantId: string,
  laneIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(laneIds)];
  if (ids.length === 0) return;

  // Every writer locks the same parent rows, even if no overlapping booking exists yet.
  const lanes = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id"
    FROM "Lane"
    WHERE "tenantId" = ${tenantId}::uuid
      AND "id" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY "id"
    FOR UPDATE
  `;
  if (lanes.length !== ids.length) {
    throw new NotFoundException('Lane not found');
  }
}
