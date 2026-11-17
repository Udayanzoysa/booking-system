import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PermissionCode } from './permissions';

export class RolePermissionsDto {
  @IsArray()
  @ArrayMaxSize(Object.keys(PermissionCode).length)
  @ArrayUnique()
  @IsEnum(PermissionCode, { each: true })
  permissionCodes!: PermissionCode[];
}

export class CreateRoleDto extends RolePermissionsDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 80)
  name!: string;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(300)
  description?: string;
}
