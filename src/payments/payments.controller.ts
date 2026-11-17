import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/auth-principal';
import { CurrentUser } from '../auth/auth.decorators';
import { PermissionCode, RequirePermissions } from '../rbac/permissions';
import { ManualPaymentDto, WalletCollectionDto } from './payments.dto';
import { PaymentsService } from './payments.service';

@Controller('payments/:bookingId')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('collections')
  @RequirePermissions(PermissionCode.RECORD_PAYMENT)
  collect(
    @CurrentUser() principal: AuthPrincipal,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() dto: ManualPaymentDto,
  ) {
    return this.payments.recordCollection(principal, bookingId, dto);
  }

  @Post('wallet-collections')
  wallet(
    @CurrentUser() principal: AuthPrincipal,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() dto: WalletCollectionDto,
  ) {
    return this.payments.payFromWallet(principal, bookingId, dto);
  }

  @Post('refunds')
  @RequirePermissions(PermissionCode.ISSUE_REFUND)
  refund(
    @CurrentUser() principal: AuthPrincipal,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() dto: ManualPaymentDto,
  ) {
    return this.payments.recordRefund(principal, bookingId, dto);
  }
}
