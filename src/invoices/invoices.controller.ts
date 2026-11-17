import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators';
import type { AuthPrincipal } from '../auth/auth-principal';
import { ManualPaymentDto } from '../payments/payments.dto';
import { PermissionCode, RequirePermissions } from '../rbac/permissions';
import { InvoiceListDto, IssueCreditNoteDto } from './invoices.dto';
import { InvoicesService } from './invoices.service';

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  list(@CurrentUser() user: AuthPrincipal, @Query() query: InvoiceListDto) {
    return this.invoices.list(user, query);
  }

  @Get('booking/:bookingId')
  forBooking(@CurrentUser() user: AuthPrincipal, @Param('bookingId', ParseUUIDPipe) bookingId: string) {
    return this.invoices.forBooking(user, bookingId);
  }

  @Post('booking/:bookingId')
  @RequirePermissions(PermissionCode.MANAGE_INVOICES)
  issue(@CurrentUser() user: AuthPrincipal, @Param('bookingId', ParseUUIDPipe) bookingId: string) {
    return this.invoices.issue(user, bookingId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.get(user, id);
  }

  @Post(':id/credit-notes')
  @RequirePermissions(PermissionCode.MANAGE_INVOICES)
  credit(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: IssueCreditNoteDto) {
    return this.invoices.credit(user, id, dto);
  }

  @Post(':id/collections')
  @RequirePermissions(PermissionCode.MANAGE_INVOICES, PermissionCode.RECORD_PAYMENT)
  collect(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ManualPaymentDto) {
    return this.invoices.collect(user, id, dto);
  }
}

