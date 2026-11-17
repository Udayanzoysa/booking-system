import { IsUUID } from 'class-validator';
import { TimeRangeDto } from '../lanes/time-range.dto';

export class CreateRosterShiftDto extends TimeRangeDto {
  @IsUUID()
  staffId!: string;
}
