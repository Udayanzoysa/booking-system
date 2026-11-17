import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { CancellationFeeType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PublishCancellationPolicyDto } from './policies.dto';

@Injectable()
export class PoliciesService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, includeInactive: boolean) {
    return this.prisma.cancellationPolicy.findMany({
      where: { tenantId, isActive: includeInactive ? undefined : true },
      orderBy: [{ name: 'asc' }, { version: 'desc' }],
      include: { tiers: { orderBy: { minimumNoticeMinutes: 'asc' } } },
    });
  }

  async publish(tenantId: string, dto: PublishCancellationPolicyDto) {
    const name = dto.name.trim();
    const feeValue = new Prisma.Decimal(dto.partialFeeValue);
    if (feeValue.lte(0) || (dto.partialFeeType === CancellationFeeType.PERCENT_OF_BOOKING_TOTAL && feeValue.gte(100))) {
      throw new BadRequestException('The partial fee must be positive and any percentage must be below 100');
    }

    return this.prisma.$transaction(async (tx) => {
      // Serialize publication when there is no earlier policy version to lock.
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId}::uuid FOR UPDATE`;
      const versions = await tx.cancellationPolicy.aggregate({
        where: { tenantId, name },
        _max: { version: true },
      });
      await tx.cancellationPolicy.updateMany({ where: { tenantId, name, isActive: true }, data: { isActive: false } });
      return tx.cancellationPolicy.create({
        data: {
          tenantId,
          name,
          version: (versions._max.version ?? 0) + 1,
          allowWalletCredit: dto.allowWalletCredit,
          tiers: {
            create: [
              { minimumNoticeMinutes: 0, feeType: CancellationFeeType.FORFEIT_PAID_AMOUNT },
              { minimumNoticeMinutes: 360, feeType: dto.partialFeeType, feeValue },
              { minimumNoticeMinutes: 1440, minimumInclusive: false, feeType: CancellationFeeType.FREE },
            ],
          },
        },
        include: { tiers: { orderBy: { minimumNoticeMinutes: 'asc' } } },
      });
    });
  }

  async cancellationTerms(
    tx: Prisma.TransactionClient,
    tenantId: string,
    policyId: string,
    asOf: Date,
    startsAt: Date,
    totalAmount: Prisma.Decimal,
    amountPaid: Prisma.Decimal,
  ) {
    const policy = await tx.cancellationPolicy.findUnique({
      where: { tenantId_id: { tenantId, id: policyId } },
      include: { tiers: { orderBy: { minimumNoticeMinutes: 'desc' } } },
    });
    if (!policy) {
      throw new NotFoundException('Cancellation policy not found');
    }

    const notice = Math.max(0, startsAt.getTime() - asOf.getTime());
    const tier = policy.tiers.find(({ minimumNoticeMinutes, minimumInclusive }) => {
      const threshold = minimumNoticeMinutes * 60_000;
      return minimumInclusive ? notice >= threshold : notice > threshold;
    });
    if (!tier) {
      throw new UnprocessableEntityException('The cancellation policy has no applicable fee tier');
    }

    let fee: Prisma.Decimal;
    switch (tier.feeType) {
      case CancellationFeeType.FREE:
        fee = new Prisma.Decimal(0);
        break;
      case CancellationFeeType.FORFEIT_PAID_AMOUNT:
        fee = amountPaid;
        break;
      default: {
        if (tier.feeValue === null) {
          throw new UnprocessableEntityException('The cancellation policy lacks a fee value');
        }
        fee = tier.feeType === CancellationFeeType.PERCENT_OF_BOOKING_TOTAL
          ? totalAmount.mul(tier.feeValue).div(100)
          : Prisma.Decimal.min(tier.feeValue, totalAmount);
      }
    }
    return { fee: fee.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP), allowWalletCredit: policy.allowWalletCredit };
  }
}
