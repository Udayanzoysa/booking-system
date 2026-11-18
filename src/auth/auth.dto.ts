import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const demoAccounts = ['admin', 'nimal', 'kamal'] as const;
export type DemoAccount = typeof demoAccounts[number];

export class DemoLoginDto {
  @IsIn(demoAccounts)
  account!: DemoAccount;
}

class EmailDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class LoginDto extends EmailDto {
  @IsString()
  @Length(1, 100)
  tenantSlug!: string;

  @IsString()
  @Length(1, 128)
  password!: string;
}

export class GoogleLoginDto {
  @IsString()
  @Length(1, 100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  tenantSlug!: string;

  @IsString()
  @Length(100, 8192)
  credential!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  nonce!: string;
}

export class CreateStaffDto extends EmailDto {
  @IsString()
  @Length(12, 128)
  password!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 120)
  displayName!: string;
}

export class RegisterDto extends CreateStaffDto {
  @IsString()
  @Length(1, 100)
  tenantSlug!: string;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/^\+?[0-9][0-9 ()-]{5,23}$/)
  phone?: string;
}

export class ListStaffDto {
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsUUID()
  cursor?: string;
}
