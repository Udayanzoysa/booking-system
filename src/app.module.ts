import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { AvailabilityModule } from './availability/availability.module';
import { BookingsModule } from './bookings/bookings.module';
import { InvoicesModule } from './invoices/invoices.module';
import { LanesModule } from './lanes/lanes.module';
import { PaymentsModule } from './payments/payments.module';
import { PoliciesModule } from './policies/policies.module';
import { PrismaModule } from './prisma/prisma.module';
import { RbacModule } from './rbac/rbac.module';
import { RosterModule } from './roster/roster.module';
import { TenantsModule } from './tenants/tenants.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    RbacModule,
    AvailabilityModule,
    TenantsModule,
    LanesModule,
    PaymentsModule,
    BookingsModule,
    InvoicesModule,
    PoliciesModule,
    RosterModule,
  ],
})
export class AppModule {}
