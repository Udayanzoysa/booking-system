import { CancellationFeeType } from '@prisma/client';
import { IsBoolean, IsIn, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

export class PublishCancellationPolicyDto {
  @IsString()
  @Matches(/\S/u)
  @MaxLength(120)
  name!: string;

  @IsIn([CancellationFeeType.PERCENT_OF_BOOKING_TOTAL, CancellationFeeType.FIXED])
  partialFeeType!: typeof CancellationFeeType.PERCENT_OF_BOOKING_TOTAL | typeof CancellationFeeType.FIXED;

  @IsString()
  @Matches(/^\d{1,10}(?:\.\d{1,4})?$/u)
  partialFeeValue!: string;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  allowWalletCredit?: boolean;
}
