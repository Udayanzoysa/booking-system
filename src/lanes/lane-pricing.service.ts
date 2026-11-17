import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DayOfWeek, PricingTier, Prisma } from '@prisma/client';

type Rate = {
  dayOfWeek: DayOfWeek;
  startMinute: number;
  endMinute: number;
  pricePerHour: Prisma.Decimal;
  tier: PricingTier;
};

const MINUTE_MS = 60 * 1000;

export function lanePriceCalculator(timeZone: string, rules: Rate[]) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const byDay = new Map<DayOfWeek, Rate[]>();
  for (const rule of rules) {
    const rates = byDay.get(rule.dayOfWeek) ?? [];
    rates.push(rule);
    byDay.set(rule.dayOfWeek, rates);
  }
  const byInstant = new Map<number, Rate | null>();

  function rateAt(minuteStart: number) {
    const cached = byInstant.get(minuteStart);
    if (cached !== undefined) {
      return cached;
    }

    const parts = formatter.formatToParts(minuteStart);
    const day = parts.find(({ type }) => type === 'weekday')?.value.toUpperCase() as DayOfWeek;
    const hour = Number(parts.find(({ type }) => type === 'hour')?.value);
    const minute = hour * 60 + Number(parts.find(({ type }) => type === 'minute')?.value);
    const rates = byDay.get(day)?.filter((rule) => rule.startMinute <= minute && minute < rule.endMinute);
    const rate = rates?.length === 1 ? rates[0] : null;
    byInstant.set(minuteStart, rate);
    return rate;
  }

  return (startsAt: Date, endsAt: Date) => {
    const end = endsAt.getTime();
    const elapsedByRate = new Map<Rate, number>();
    for (let time = startsAt.getTime(); time < end;) {
      const minuteStart = Math.floor(time / MINUTE_MS) * MINUTE_MS;
      const rate = rateAt(minuteStart);
      if (!rate) {
        return null;
      }

      const boundary = Math.min(end, minuteStart + MINUTE_MS);
      elapsedByRate.set(rate, (elapsedByRate.get(rate) ?? 0) + boundary - time);
      time = boundary;
    }

    let charge = new Prisma.Decimal(0);
    const tiers = new Set<PricingTier>();
    for (const [rate, elapsed] of elapsedByRate) {
      charge = charge.plus(rate.pricePerHour.mul(elapsed));
      tiers.add(rate.tier);
    }
    return {
      total: charge.div(60 * MINUTE_MS).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP),
      tiers: [...tiers],
    };
  };
}

@Injectable()
export class LanePricingService {
  async quote(tx: Prisma.TransactionClient, tenantId: string, laneId: string, startsAt: Date, endsAt: Date) {
    const lane = await tx.lane.findUnique({
      where: { tenantId_id: { tenantId, id: laneId } },
      select: { branch: { select: { timeZone: true } }, pricingRules: true },
    });
    if (!lane) {
      throw new NotFoundException('Lane not found');
    }

    const quote = lanePriceCalculator(lane.branch.timeZone, lane.pricingRules)(startsAt, endsAt);
    if (!quote) {
      throw new UnprocessableEntityException('The slot requires a complete, non-overlapping lane tariff');
    }
    return quote.total;
  }
}
