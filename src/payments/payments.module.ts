import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { CustomerPaymentsController } from './customer-payments.controller';
import { CustomerPaymentsService } from './customer-payments.service';

@Module({
  controllers: [CustomerPaymentsController, PaymentsController],
  providers: [PaymentsService, CustomerPaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
