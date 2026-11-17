import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class UpdateTenantDto {
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/\S/u)
  @MaxLength(120)
  name?: string;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  unpaidHoldMinutes?: number;
}

export class CreateBranchDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]+$/u)
  @MaxLength(40)
  code!: string;

  @IsString()
  @Matches(/\S/u)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MaxLength(120)
  timeZone!: string;

  @IsOptional()
  @IsUUID()
  webLeadOwnerId?: string | null;
}

export class UpdateBranchDto {
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/\S/u)
  @MaxLength(120)
  name?: string;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(120)
  timeZone?: string;

  @IsOptional()
  @IsUUID()
  webLeadOwnerId?: string | null;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
