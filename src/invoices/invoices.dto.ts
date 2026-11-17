import { IsDateString, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { EXPLICIT_OFFSET } from '../lanes/time-range.dto';

export class InvoiceListDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsDateString({ strict: true, strictSeparator: true })
  @Matches(EXPLICIT_OFFSET)
  startsAt?: string;

  @IsOptional()
  @IsDateString({ strict: true, strictSeparator: true })
  @Matches(EXPLICIT_OFFSET)
  endsAt?: string;

  @IsOptional()
  @Matches(/^\d{1,10}$/u)
  before?: string;
}

export class IssueCreditNoteDto {
  @IsUUID()
  idempotencyKey!: string;

  @IsString()
  @Matches(/\S/u)
  @MaxLength(500)
  reason!: string;

  @Matches(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/u)
  amount!: string;
}

