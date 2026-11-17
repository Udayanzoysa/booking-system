import { DayOfWeek, LaneType, PricingTier, SlotKind } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsEnum, IsInt, IsString, IsUUID,
  Matches, Max, MaxLength, Min, ValidateIf, ValidateNested,
} from 'class-validator';
import { TimeRangeDto } from './time-range.dto';

export class CreateLaneDto {
  @IsUUID()
  branchId!: string;

  @IsString()
  @Matches(/\S/u)
  @MaxLength(120)
  name!: string;

  @IsEnum(LaneType)
  type!: LaneType;
}

export class UpdateLaneDto {
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/\S/u)
  @MaxLength(120)
  name?: string;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}

export class CreateSlotDto extends TimeRangeDto {
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsEnum(SlotKind)
  kind?: SlotKind;
}

class LaneRateDto {
  @IsEnum(DayOfWeek)
  dayOfWeek!: DayOfWeek;

  @IsEnum(PricingTier)
  tier!: PricingTier;

  @IsInt()
  @Min(0)
  @Max(1439)
  startMinute!: number;

  @IsInt()
  @Min(1)
  @Max(1440)
  endMinute!: number;

  @IsString()
  @Matches(/^\d{1,7}(?:\.\d{1,4})?$/u)
  pricePerHour!: string;
}

export class ReplaceLanePricingDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(336)
  @ValidateNested({ each: true })
  @Type(() => LaneRateDto)
  rules!: LaneRateDto[];
}
