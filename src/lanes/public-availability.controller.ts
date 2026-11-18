import { Controller, Get, Header, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Public } from '../auth/auth.decorators';
import { LanesService } from './lanes.service';
import { TimeRangeDto } from './time-range.dto';

@Public()
@Controller('public/tenants/:slug')
export class PublicAvailabilityController {
  constructor(private readonly lanes: LanesService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  tenant(@Param('slug') slug: string) { return this.lanes.publicTenant(slug); }

  @Get('branches/:branchId/availability')
  @Header('Cache-Control', 'no-store')
  availability(@Param('slug') slug: string, @Param('branchId', ParseUUIDPipe) branchId: string, @Query() range: TimeRangeDto) {
    return this.lanes.publicAvailability(slug, branchId, range);
  }
}
