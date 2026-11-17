import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from './auth/password';
import { PermissionCode } from './rbac/permissions';
import { requireSampleDatabase } from './sample-database';

const slug = 'techwing-auth-sample';
const adminEmail = 'admin@example.test';
const staffEmail = 'staff@example.test';
const password = 'Techwing-Local-Test-2026!';
const staffPermissions = new Set<string>([
  PermissionCode.VIEW_BOOKINGS,
  PermissionCode.MANAGE_BOOKINGS,
  PermissionCode.CREATE_UNPAID_HOLD,
  PermissionCode.RECORD_PAYMENT,
  PermissionCode.MANAGE_CUSTOMERS,
]);

async function seed() {
  requireSampleDatabase();

  const prisma = new PrismaClient();
  try {
    const passwordHash = await hashPassword(password);
    const created = await prisma.$transaction(async (tx) => {
      const [tenant] = await tx.tenant.createManyAndReturn({
        data: [{ slug, name: 'Techwing Sample Arena', currency: 'LKR', unpaidHoldMinutes: 15 }],
        skipDuplicates: true,
      });
      if (!tenant) return false;
      const tenantId = tenant.id;
      const permissions = await tx.permission.createManyAndReturn({
        data: Object.values(PermissionCode).map((code) => ({ tenantId, code })),
      });
      const fixtures = [
        { name: 'Administrator', email: adminEmail, displayName: 'Sample Admin', grants: permissions },
        { name: 'Booking Staff', email: staffEmail, displayName: 'Sample Staff', grants: permissions.filter(({ code }) => staffPermissions.has(code)) },
      ];
      for (const { name, email, displayName, grants } of fixtures) {
        const role = await tx.role.create({ data: { tenantId, name } });
        const user = await tx.user.create({ data: { tenantId, email, displayName, passwordHash } });
        await tx.rolePermission.createMany({
          data: grants.map(({ id: permissionId }) => ({ tenantId, permissionId, roleId: role.id })),
        });
        await tx.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id } });
      }
      return true;
    });

    if (created) console.log('Created tenant %s with %s and %s.', slug, adminEmail, staffEmail);
    else console.log('Sample tenant already exists. Existing users and grants were preserved.');
  } finally {
    await prisma.$disconnect();
  }
}

void seed().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Sample account creation failed.');
  process.exitCode = 1;
});
