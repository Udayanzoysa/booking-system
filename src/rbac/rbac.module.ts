import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { RbacController } from './rbac.controller';
import { RbacService } from './rbac.service';

@Module({
  controllers: [RbacController],
  providers: [
    RbacService,
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class RbacModule {}
