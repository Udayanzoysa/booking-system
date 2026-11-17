import { LeadSource } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ManualPaymentDto } from '../payments/payments.dto';
import { EXPLICIT_OFFSET } from '../lanes/time-range.dto';

export class CreateBookingDto {
  @IsUUID()
  slotId!: string;

  @IsInt()
  @Min(1)
  @Max(2147483647)
  headcount!: number;

  @IsOptional()
  @IsEnum(LeadSource)
  leadSource?: LeadSource;

  @IsOptional()
  @IsUUID()
  leadOwnerId?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  cancellationPolicyId?: string;

  @IsOptional()
  @Matches(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/)
  depositRequired?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ManualPaymentDto)
  initialPayment?: ManualPaymentDto;

  @IsOptional()
  @IsUUID()
  initialWalletPaymentKey?: string;
}

export class BookingListDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsDateString({ strict: true, strictSeparator: true })
  @Matches(EXPLICIT_OFFSET)
  startsAt?: string;

  @IsOptional()
  @IsDateString({ strict: true, strictSeparator: true })
  @Matches(EXPLICIT_OFFSET)
  endsAt?: string;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class RescheduleBookingDto {
  @IsUUID()
  slotId!: string;
}

export class CancelBookingDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @IsOptional()
  @IsBoolean()
  waiveFee?: boolean;

  @IsOptional()
  @IsBoolean()
  creditWallet?: boolean;
}
