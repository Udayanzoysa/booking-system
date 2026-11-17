import { IsEmail, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';

const PHONE = /^\+[1-9]\d{6,14}$/u;

export class CustomerListQueryDto {
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsUUID()
  after?: string;
}

export class CreateCustomerDto {
  @IsString()
  @Matches(/\S/u)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @Matches(PHONE, { message: 'phone must use international format' })
  phone?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string | null;
}

export class UpdateOwnCustomerDto {
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/\S/u)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Matches(PHONE, { message: 'phone must use international format' })
  phone?: string | null;
}

export class UpdateCustomerDto extends UpdateOwnCustomerDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string | null;
}
