import { Module } from '@nestjs/common';
import { RosterModule } from '../roster/roster.module';
import { LanePricingService } from './lane-pricing.service';
import { LanesController } from './lanes.controller';
import { LanesService } from './lanes.service';
import { PublicAvailabilityController } from './public-availability.controller';

@Module({
  imports: [RosterModule],
  controllers: [LanesController, PublicAvailabilityController],
  providers: [LanesService, LanePricingService],
  exports: [LanePricingService],
})
export class LanesModule {}
