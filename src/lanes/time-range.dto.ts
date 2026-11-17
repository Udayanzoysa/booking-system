import { BadRequestException } from '@nestjs/common';
import { IsDateString, Matches } from 'class-validator';

export const EXPLICIT_OFFSET = /T.*(?:Z|[+-][0-9]{2}:[0-9]{2})$/u;
const DAY_MS = 24 * 60 * 60 * 1000;

export class TimeRangeDto {
  @IsDateString({ strict: true, strictSeparator: true })
  @Matches(EXPLICIT_OFFSET, { message: 'startsAt must include a time zone offset' })
  startsAt!: string;

  @IsDateString({ strict: true, strictSeparator: true })
  @Matches(EXPLICIT_OFFSET, { message: 'endsAt must include a time zone offset' })
  endsAt!: string;
}

export function readTimeRange(dto: TimeRangeDto, maxDays: number) {
  const startsAt = new Date(dto.startsAt);
  const endsAt = new Date(dto.endsAt);
  const length = endsAt.getTime() - startsAt.getTime();
  if (!(length > 0 && length <= maxDays * DAY_MS)) {
    throw new BadRequestException(`The time range must be positive and at most ${maxDays} days`);
  }
  return { startsAt, endsAt };
}
