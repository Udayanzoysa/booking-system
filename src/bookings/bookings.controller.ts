import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/auth-principal';
import { CurrentUser } from '../auth/auth.decorators';
import { BookingListDto, CancelBookingDto, CreateBookingDto, RescheduleBookingDto } from './bookings.dto';
import { BookingsService } from './bookings.service';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  list(@CurrentUser() principal: AuthPrincipal, @Query() query: BookingListDto) {
    return this.bookings.list(principal, query);
  }

  @Get(':id')
  get(@CurrentUser() principal: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.get(principal, id);
  }

  @Post()
  create(@CurrentUser() principal: AuthPrincipal, @Body() dto: CreateBookingDto) {
    return this.bookings.create(principal, dto);
  }

  @Post(':id/reschedule')
  reschedule(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleBookingDto,
  ) {
    return this.bookings.reschedule(principal, id, dto);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelBookingDto,
  ) {
    return this.bookings.cancel(principal, id, dto);
  }
}
