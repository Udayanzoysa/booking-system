import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators';
import type { AuthPrincipal } from '../auth/auth-principal';
import { PermissionCode, RequirePermissions } from '../rbac/permissions';
import { CreateCustomerDto, CustomerListQueryDto, UpdateCustomerDto, UpdateOwnCustomerDto } from './customers.dto';
import { CustomersService } from './customers.service';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get('me')
  own(@CurrentUser() user: AuthPrincipal) {
    return this.customers.own(user.tenantId, user.userId);
  }

  @Patch('me')
  updateOwn(@CurrentUser() user: AuthPrincipal, @Body() dto: UpdateOwnCustomerDto) {
    return this.customers.updateOwn(user.tenantId, user.userId, dto);
  }

  @Get()
  @RequirePermissions(PermissionCode.MANAGE_CUSTOMERS)
  list(@CurrentUser() user: AuthPrincipal, @Query() query: CustomerListQueryDto) {
    return this.customers.list(user.tenantId, query.after);
  }

  @Get(':customerId')
  @RequirePermissions(PermissionCode.MANAGE_CUSTOMERS)
  get(@CurrentUser() user: AuthPrincipal, @Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.customers.get(user.tenantId, customerId);
  }

  @Get(':customerId/phone')
  @RequirePermissions(PermissionCode.VIEW_CUSTOMER_PHONE)
  getUnmaskedPhone(@CurrentUser() user: AuthPrincipal, @Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.customers.getUnmaskedPhone(user.tenantId, customerId);
  }

  @Post()
  @RequirePermissions(PermissionCode.MANAGE_CUSTOMERS)
  create(@CurrentUser() user: AuthPrincipal, @Body() dto: CreateCustomerDto) {
    return this.customers.create(user.tenantId, dto);
  }

  @Patch(':customerId')
  @RequirePermissions(PermissionCode.MANAGE_CUSTOMERS)
  update(
    @CurrentUser() user: AuthPrincipal,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customers.update(user.tenantId, customerId, dto);
  }
}
