import { Injectable } from '@nestjs/common';
import { AvailabilityGateway } from './availability.gateway';

@Injectable()
export class AvailabilityEvents {
  constructor(private readonly gateway: AvailabilityGateway) {}

  changed(tenantId: string): void {
    this.gateway.changed(tenantId);
  }
}
