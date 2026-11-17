import 'reflect-metadata';
import { Prisma, PrismaClient } from '@prisma/client';
import { isEmail, isISO4217CurrencyCode } from 'class-validator';
import { hashPassword } from './auth/password';
import { PermissionCode, WEB_CUSTOMER_ROLE_NAME } from './rbac/permissions';

function readEnvironment(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

async function bootstrapTenant(prisma: PrismaClient): Promise<void> {
  const slug = readEnvironment('BOOTSTRAP_TENANT_SLUG').toLowerCase();
  const name = readEnvironment('BOOTSTRAP_TENANT_NAME');
  const currency = readEnvironment('BOOTSTRAP_CURRENCY').toUpperCase();
  const unpaidHoldMinutes = Number(readEnvironment('BOOTSTRAP_UNPAID_HOLD_MINUTES'));
  const email = readEnvironment('BOOTSTRAP_ADMIN_EMAIL').toLowerCase();
  const displayName = readEnvironment('BOOTSTRAP_ADMIN_NAME');
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? '';

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
    throw new Error('BOOTSTRAP_TENANT_SLUG must contain at most 80 letters, digits, and separating hyphens');
  }
  if (!isISO4217CurrencyCode(currency)) {
    throw new Error('BOOTSTRAP_CURRENCY must be an ISO 4217 currency code');
  }
  if (!Number.isInteger(unpaidHoldMinutes) || unpaidHoldMinutes < 1 || unpaidHoldMinutes > 1440) {
    throw new Error('BOOTSTRAP_UNPAID_HOLD_MINUTES must be an integer between 1 and 1440');
  }
  if (!isEmail(email) || email.length > 254) {
    throw new Error('BOOTSTRAP_ADMIN_EMAIL must be a valid email address');
  }
  if (password.length < 12 || password.length > 128) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must contain between 12 and 128 characters');
  }

  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    const { id: tenantId } = await tx.tenant.create({
      data: { slug, name, currency, unpaidHoldMinutes },
      select: { id: true },
    });
    const user = await tx.user.create({
      data: { tenantId, email, displayName, passwordHash },
      select: { id: true },
    });
    const admin = await tx.role.create({
      data: { tenantId, name: 'Administrator' },
      select: { id: true },
    });
    const webCustomer = await tx.role.create({
      data: { tenantId, name: WEB_CUSTOMER_ROLE_NAME },
      select: { id: true },
    });
    const permissions = await tx.permission.createManyAndReturn({
      data: Object.values(PermissionCode).map((code) => ({ tenantId, code })),
      select: { id: true, code: true },
    });
    await tx.rolePermission.createMany({
      data: permissions.flatMap(({ id: permissionId, code }) => {
        const roles = code === PermissionCode.CREATE_UNPAID_HOLD ? [admin, webCustomer] : [admin];
        return roles.map(({ id: roleId }) => ({ tenantId, roleId, permissionId }));
      }),
    });
    await tx.userRole.create({
      data: { tenantId, userId: user.id, roleId: admin.id },
    });
  });
  console.log('Tenant and initial administrator created.');
}

const prisma = new PrismaClient();
void bootstrapTenant(prisma).catch((error: unknown) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    console.error('A tenant with that slug already exists.');
  } else if (error instanceof Error && error.message.startsWith('BOOTSTRAP_')) {
    console.error(error.message);
  } else {
    console.error('Tenant setup failed. Check the PostgreSQL connection and applied migrations.');
  }
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
