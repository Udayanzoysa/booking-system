import { BankTransferSlipStatus } from '@prisma/client';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { WalletCollectionDto } from './payments.dto';

export class PayHereCheckoutDto {
  @IsUUID()
  idempotencyKey!: string;

  @IsString()
  @MaxLength(160)
  billingAddress!: string;

  @IsString()
  @MaxLength(80)
  billingCity!: string;

  @Matches(/^[+\d][\d ()-]{6,23}$/)
  billingPhone!: string;
}

export class BankTransferSlipDto extends WalletCollectionDto {
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED'])
  reviewDecision?: 'PENDING' | 'APPROVED';

  @IsOptional()
  @IsString()
  @MaxLength(160)
  reference?: string;
}

export class BankSlipListDto {
  @IsOptional()
  @IsEnum(BankTransferSlipStatus)
  status?: BankTransferSlipStatus;
}

export class BankSlipReviewDto {
  @IsIn(['APPROVED', 'REJECTED'])
  decision!: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class PaymentSettingsDto {
  @IsOptional()
  @IsBoolean()
  bankTransferEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  accountName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  accountNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankBranch?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  instructions?: string;

  @IsOptional()
  @IsBoolean()
  payhereEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  payhereSandbox?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  payhereMerchantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  payhereMerchantSecret?: string;

  @IsOptional()
  @IsBoolean()
  clearPayhereMerchantSecret?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  payhereNotifyUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  payhereReturnOrigin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  contactPhone?: string;
}

export interface SlipAttachment {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}
