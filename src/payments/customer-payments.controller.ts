import {
  Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Query,
  StreamableFile, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthPrincipal } from '../auth/auth-principal';
import { CurrentUser, Public } from '../auth/auth.decorators';
import { PermissionCode, RequirePermissions } from '../rbac/permissions';
import {
  BankSlipListDto, BankSlipReviewDto, BankTransferSlipDto, PayHereCheckoutDto, PaymentSettingsDto, type SlipAttachment,
} from './customer-payments.dto';
import { CustomerPaymentsService } from './customer-payments.service';

@Controller('payments')
export class CustomerPaymentsController {
  constructor(private readonly payments: CustomerPaymentsService) {}

  @Get('options')
  @Header('Cache-Control', 'private, no-store')
  options(@CurrentUser() principal: AuthPrincipal) { return this.payments.options(principal); }

  @Get('settings')
  @RequirePermissions(PermissionCode.MANAGE_TENANT)
  settings(@CurrentUser() principal: AuthPrincipal) { return this.payments.settings(principal); }

  @Put('settings')
  @RequirePermissions(PermissionCode.MANAGE_TENANT)
  saveSettings(@CurrentUser() principal: AuthPrincipal, @Body() dto: PaymentSettingsDto) {
    return this.payments.saveSettings(principal, dto);
  }

  @Post('payhere/notify')
  @Public()
  @HttpCode(200)
  notify(@Body() fields: Record<string, unknown>) { return this.payments.notify(fields); }

  @Get('bank-transfer-slips')
  @RequirePermissions(PermissionCode.RECORD_PAYMENT)
  list(@CurrentUser() principal: AuthPrincipal, @Query() query: BankSlipListDto) {
    return this.payments.listSlips(principal, query);
  }

  @Post('bank-transfer-slips/:id/review')
  @RequirePermissions(PermissionCode.RECORD_PAYMENT)
  review(@CurrentUser() principal: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BankSlipReviewDto) {
    return this.payments.reviewSlip(principal, id, dto);
  }

  @Get('bank-transfer-slips/:id/attachment')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async attachment(@CurrentUser() principal: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    const file = await this.payments.attachment(principal, id);
    return new StreamableFile(Buffer.from(file.attachment), {
      type: file.mimeType,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      length: file.fileSize,
    });
  }

  @Post(':bookingId/payhere')
  checkout(@CurrentUser() principal: AuthPrincipal, @Param('bookingId', ParseUUIDPipe) id: string, @Body() dto: PayHereCheckoutDto) {
    return this.payments.checkout(principal, id, dto);
  }

  @Get(':bookingId/bank-transfer-slips')
  bookingSlips(@CurrentUser() principal: AuthPrincipal, @Param('bookingId', ParseUUIDPipe) id: string) {
    return this.payments.bookingSlips(principal, id);
  }

  @Post(':bookingId/bank-transfer-slips')
  @UseInterceptors(FileInterceptor('attachment', { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 4, parts: 5 } }))
  upload(
    @CurrentUser() principal: AuthPrincipal,
    @Param('bookingId', ParseUUIDPipe) id: string,
    @Body() dto: BankTransferSlipDto,
    @UploadedFile() attachment?: SlipAttachment,
  ) {
    return this.payments.uploadSlip(principal, id, dto, attachment);
  }
}
