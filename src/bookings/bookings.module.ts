import { Module } from '@nestjs/common';
import { LanesModule } from '../lanes/lanes.module';
import { PaymentsModule } from '../payments/payments.module';
import { PoliciesModule } from '../policies/policies.module';
import { RosterModule } from '../roster/roster.module';
import { BookingExpiry } from './booking-expiry';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  imports: [LanesModule, PaymentsModule, PoliciesModule, RosterModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingExpiry],
})
export class BookingsModule {}
