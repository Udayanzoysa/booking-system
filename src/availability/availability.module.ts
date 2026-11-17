import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AvailabilityEvents } from './availability.events';
import { AvailabilityGateway } from './availability.gateway';

@Global()
@Module({
  imports: [AuthModule],
  providers: [AvailabilityGateway, AvailabilityEvents],
  exports: [AvailabilityEvents],
})
export class AvailabilityModule {}
