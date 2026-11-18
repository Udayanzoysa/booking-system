import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { DayOfWeek, Prisma, PrismaClient } from '@prisma/client';
import { isEmail } from 'class-validator';
import { hashPassword } from './auth/password';
import { PermissionCode, WEB_CUSTOMER_ROLE_NAME } from './rbac/permissions';

const staffGrants = new Set<string>([
  PermissionCode.VIEW_BOOKINGS, PermissionCode.MANAGE_BOOKINGS,
  PermissionCode.CREATE_UNPAID_HOLD, PermissionCode.RECORD_PAYMENT,
  PermissionCode.MANAGE_CUSTOMERS,
]);
const read = (name: string, fallback = '') => process.env[name]?.trim() || fallback;
function password(name: string): string {
  const value = process.env[name] ?? '';
  if (value.length < 12 || value.length > 128) throw new Error(`${name} must contain 12–128 characters`);
  return value;
}
function fixtureId(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function bootstrapStrikz(prisma: PrismaClient): Promise<void> {
  const slug = read('BOOTSTRAP_TENANT_SLUG', 'strikzclub-homagama');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) throw new Error('Invalid BOOTSTRAP_TENANT_SLUG');
  const existing = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (existing) {
    console.log('Strikz arena already exists. Existing accounts, pricing and bookings were preserved.');
    return;
  }
  const adminEmail = read('BOOTSTRAP_ADMIN_EMAIL', 'admin@strikzclub.test').toLowerCase();
  const staffEmail = read('BOOTSTRAP_STAFF_EMAIL', 'staff@strikzclub.test').toLowerCase();
  if (![adminEmail, staffEmail].every(value => isEmail(value)) || adminEmail === staffEmail) throw new Error('Provide distinct valid administrator and staff emails');
  const [adminHash, staffHash] = await Promise.all([
    hashPassword(password('BOOTSTRAP_ADMIN_PASSWORD')), hashPassword(password('BOOTSTRAP_STAFF_PASSWORD')),
  ]);
  const price = read('BOOTSTRAP_PRICE_PER_HOUR');
  if (price && (!/^\d{1,7}(?:\.\d{1,4})?$/.test(price) || new Prisma.Decimal(price).lte(0))) throw new Error('BOOTSTRAP_PRICE_PER_HOUR must be positive');
  const days = Number(read('BOOTSTRAP_SCHEDULE_DAYS', '14'));
  const holdMinutes = Number(read('BOOTSTRAP_UNPAID_HOLD_MINUTES', '15'));
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('BOOTSTRAP_SCHEDULE_DAYS must be 1–90');
  if (!Number.isInteger(holdMinutes) || holdMinutes < 1 || holdMinutes > 1440) throw new Error('BOOTSTRAP_UNPAID_HOLD_MINUTES must be 1–1440');
  await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({ data: {
      slug, name: read('BOOTSTRAP_TENANT_NAME', 'Strikz Club - Homagama'), currency: 'LKR', unpaidHoldMinutes: holdMinutes,
    } });
    const tenantId = tenant.id;
    const permissions = await tx.permission.createManyAndReturn({ data: Object.values(PermissionCode).map(code => ({ tenantId, code })) });
    const adminRole = await tx.role.create({ data: { tenantId, name: 'Administrator' } });
    const staffRole = await tx.role.create({ data: { tenantId, name: 'Booking Staff' } });
    const customerRole = await tx.role.create({ data: { tenantId, name: WEB_CUSTOMER_ROLE_NAME } });
    await tx.rolePermission.createMany({ data: permissions.flatMap(({ id: permissionId, code }) => [
      { tenantId, roleId: adminRole.id, permissionId },
      ...(staffGrants.has(code) ? [{ tenantId, roleId: staffRole.id, permissionId }] : []),
      ...(code === PermissionCode.CREATE_UNPAID_HOLD ? [{ tenantId, roleId: customerRole.id, permissionId }] : []),
    ]) });
    const admin = await tx.user.create({ data: { tenantId, email: adminEmail, displayName: read('BOOTSTRAP_ADMIN_NAME', 'Strikz Administrator'), passwordHash: adminHash } });
    const staff = await tx.user.create({ data: { tenantId, email: staffEmail, displayName: read('BOOTSTRAP_STAFF_NAME', 'Strikz Staff'), passwordHash: staffHash } });
    await tx.userRole.createMany({ data: [
      { tenantId, userId: admin.id, roleId: adminRole.id }, { tenantId, userId: staff.id, roleId: staffRole.id },
    ] });
    const branch = await tx.branch.create({ data: { tenantId, code: 'homagama', name: 'Pitipana, Homagama', timeZone: 'Asia/Colombo', webLeadOwnerId: staff.id } });
    const ground = await tx.lane.create({ data: { tenantId, branchId: branch.id, name: 'Full Turf', type: 'TURF_NET' } });
    await tx.paymentSettings.create({ data: { tenantId, contactPhone: '070 126 1966' } });
    await tx.cancellationPolicy.create({ data: {
      tenantId, name: 'Standard cancellation policy', allowWalletCredit: false,
      tiers: { create: [
        { minimumNoticeMinutes: 0, feeType: 'FORFEIT_PAID_AMOUNT' },
        { minimumNoticeMinutes: 360, feeType: 'PERCENT_OF_BOOKING_TOTAL', feeValue: '25' },
        { minimumNoticeMinutes: 1440, minimumInclusive: false, feeType: 'FREE' },
      ] },
    } });
    if (price) {
      await tx.lanePricingRule.createMany({ data: Object.values(DayOfWeek).map(dayOfWeek => ({ tenantId, laneId: ground.id, dayOfWeek, tier: 'OFF_PEAK', startMinute: 0, endMinute: 1440, pricePerHour: price })) });
      // Asia/Colombo has a fixed UTC+05:30 offset. Schedule local 07:00–22:00.
      const offset = 330 * 60_000;
      const midnight = Math.floor((Date.now() + offset) / 86_400_000) * 86_400_000 - offset;
      const slots: Prisma.SlotScheduleCreateManyInput[] = [];
      for (let day = 0; day < days; day++) for (let hour = 7; hour < 22; hour++) {
        const startsAt = new Date(midnight + day * 86_400_000 + hour * 3_600_000);
        if (+startsAt <= Date.now()) continue;
        slots.push({ id: fixtureId(`${ground.id}/${startsAt.toISOString()}`), tenantId, laneId: ground.id, startsAt, endsAt: new Date(+startsAt + 3_600_000) });
      }
      if (slots.length) await tx.slotSchedule.createMany({ data: slots });
    }
  }, { timeout: 20_000 });
  console.log('Created %s: one administrator, one staff member, and Indoor Ground / Full Turf. No sample customers, bookings or invoices were created.', slug);
  if (!price) console.log('Set the ground pricing and bookable hours in the dashboard before accepting reservations.');
}

if (require.main === module) {
  const prisma = new PrismaClient();
  void bootstrapStrikz(prisma).catch(error => {
    console.error(error instanceof Error && !('code' in error) ? error.message : 'Strikz setup failed. Check the database and environment.');
    process.exitCode = 1;
  }).finally(() => prisma.$disconnect());
}
