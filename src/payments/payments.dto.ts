import { PaymentMethod } from '@prisma/client';
import { IsIn, IsUUID, Matches } from 'class-validator';

export const manualPaymentMethods = [
  PaymentMethod.CASH,
  PaymentMethod.CARD,
  PaymentMethod.BANK_TRANSFER,
] as const;

export class WalletCollectionDto {
  @IsUUID()
  idempotencyKey!: string;

  @Matches(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/)
  amount!: string;
}

export class ManualPaymentDto extends WalletCollectionDto {
  @IsIn(manualPaymentMethods)
  method!: (typeof manualPaymentMethods)[number];
}
