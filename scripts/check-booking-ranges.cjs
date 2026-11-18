// Integration checks for consecutive customer sessions, against isolated sample tenants.
// Run after build/migration: node --env-file=.sample-auth/api.env scripts/check-booking-ranges.cjs
// Never calls a payment provider or writes attachment files.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { NestFactory, HttpAdapterHost } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { AppModule } = require('../dist/app.module');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { PrismaExceptionFilter } = require('../dist/prisma/prisma-exception.filter');
const { hashPassword } = require('../dist/auth/password');
const { PermissionCode, WEB_CUSTOMER_ROLE_NAME } = require('../dist/rbac/permissions');
const { requireSampleDatabase } = require('../dist/sample-database');

async function main() {
  requireSampleDatabase();
  process.env.TECHWING_QUICK_DEMO = '0';
  const slug = 'range-check-' + randomUUID();
  const otherSlug = slug + '-other';
  const password = 'Range-check-' + randomUUID();
  const passwordHash = await hashPassword(password);
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost)));
  await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl();
  const prisma = app.get(PrismaService);
  let checks = 0;

  async function raw(path, token, body, method = 'POST') {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(origin + '/api' + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = response.status === 204 ? null : await response.json();
    checks++;
    return { status: response.status, result };
  }
  async function request(path, token, body, method = 'POST', expected = 201) {
    const { status, result } = await raw(path, token, body, method);
    // Report only the error message: authentication responses contain private tokens.
    assert.equal(status, expected, method + ' ' + path + ': ' + (result?.message || 'Unexpected HTTP status'));
    return result;
  }
  const get = (path, token, expected = 200) => request(path, token, undefined, 'GET', expected);
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  // Explicit Colombo local 19:00, independent of the host operating system time zone.
  const today = new Date();
  const base = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 3, 13, 30);
  const weekdays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

  try {
    const fixture = await prisma.$transaction(async tx => {
      const tenant = await tx.tenant.create({ data: { slug, name: 'Booking range integration fixture', currency: 'LKR', unpaidHoldMinutes: 15 } });
      const tenantId = tenant.id;
      const permissions = await tx.permission.createManyAndReturn({ data: Object.values(PermissionCode).map(code => ({ tenantId, code })) });
      async function role(name, codes) {
        const entry = await tx.role.create({ data: { tenantId, name } });
        await tx.rolePermission.createMany({ data: permissions.filter(p => codes.includes(p.code)).map(p => ({ tenantId, roleId: entry.id, permissionId: p.id })) });
        return entry;
      }
      const adminRole = await role('Administrator', Object.values(PermissionCode));
      const staffRole = await role('Booking staff', [PermissionCode.MANAGE_BOOKINGS, PermissionCode.VIEW_BOOKINGS,
        PermissionCode.CREATE_UNPAID_HOLD, PermissionCode.RECORD_PAYMENT, PermissionCode.MANAGE_INVOICES]);
      await role(WEB_CUSTOMER_ROLE_NAME, [PermissionCode.CREATE_UNPAID_HOLD]);
      async function user(email, roleId) {
        const entry = await tx.user.create({ data: { tenantId, email, displayName: email.split('@')[0], passwordHash } });
        await tx.userRole.create({ data: { tenantId, userId: entry.id, roleId } });
        return entry;
      }
      const admin = await user('admin@example.test', adminRole.id);
      const staff = await user('staff@example.test', staffRole.id);
      const branch = await tx.branch.create({ data: { tenantId, code: 'test', name: 'Test arena', timeZone: 'Asia/Colombo', webLeadOwnerId: admin.id } });
      async function lane(name, branchId = branch.id, isActive = true, mixed = false) {
        const entry = await tx.lane.create({ data: { tenantId, branchId, name, type: 'TURF_NET', isActive } });
        await tx.lanePricingRule.createMany({ data: weekdays.flatMap(dayOfWeek => mixed
          ? [{ tenantId, laneId: entry.id, dayOfWeek, tier: 'OFF_PEAK', startMinute: 0, endMinute: 1200, pricePerHour: '3000' },
            { tenantId, laneId: entry.id, dayOfWeek, tier: 'PEAK', startMinute: 1200, endMinute: 1440, pricePerHour: '4500' }]
          : [{ tenantId, laneId: entry.id, dayOfWeek, tier: 'OFF_PEAK', startMinute: 0, endMinute: 1440, pricePerHour: '3000' }]) });
        return entry;
      }
      const ground = await lane('Full Turf');
      const mixedGround = await lane('Mixed tariff ground', branch.id, true, true);
      const otherGround = await lane('Other ground');
      const inactiveGround = await lane('Inactive ground', branch.id, false);
      const inactiveBranch = await tx.branch.create({ data: { tenantId, code: 'inactive', name: 'Inactive arena', timeZone: 'Asia/Colombo', isActive: false, webLeadOwnerId: admin.id } });
      const inactiveBranchGround = await lane('Ground at inactive arena', inactiveBranch.id);
      const policy = await tx.cancellationPolicy.create({ data: { tenantId, name: 'Free cancellation test policy' } });
      await tx.cancellationPolicyTier.create({ data: { tenantId, cancellationPolicyId: policy.id, minimumNoticeMinutes: 0, feeType: 'FREE' } });
      async function segments(dayOffset, count = 2, laneId = ground.id, duration = hour) {
        const slots = [];
        for (let i = 0; i < count; i++) slots.push(await tx.slotSchedule.create({ data: {
          tenantId, laneId, startsAt: new Date(base + dayOffset * day + i * duration),
          endsAt: new Date(base + dayOffset * day + (i + 1) * duration),
        } }));
        return slots;
      }
      const held = await segments(0);
      const mixed = await segments(1, 2, mixedGround.id);
      const cancel = await segments(2);
      const wallet = await segments(3);
      const race = await segments(4, 3);
      const gap = await segments(5, 3);
      const overlap = await segments(6);
      const overlapExtra = await tx.slotSchedule.create({ data: { tenantId, laneId: ground.id, startsAt: overlap[0].startsAt, endsAt: new Date(+overlap[0].startsAt + 90 * 60_000) } });
      const crossGround = await segments(7, 2);
      const foreignGroundSlot = (await segments(7, 2, otherGround.id))[1];
      const inactive = await segments(8, 2, inactiveGround.id);
      const inactiveArena = await segments(9, 2, inactiveBranchGround.id);
      const maintenance = await segments(10, 3);
      await tx.slotSchedule.create({ data: { tenantId, laneId: ground.id, kind: 'MAINTENANCE',
        startsAt: new Date(+maintenance[1].startsAt + 15 * 60_000), endsAt: new Date(+maintenance[1].startsAt + 45 * 60_000) } });
      const occupied = await segments(11, 3);
      const maximum = await segments(12, 48, ground.id, 30 * 60_000);
      const tooLong = await segments(14, 2, ground.id, 13 * hour);
      const tooMany = await segments(16, 49, ground.id, 30 * 60_000);
      const staffSlots = await segments(18);
      const single = await segments(19);
      const past = await segments(-5);
      const outsider = await tx.tenant.create({ data: { slug: otherSlug, name: 'Other fixture tenant', currency: 'LKR', unpaidHoldMinutes: 15 } });
      const outsiderBranch = await tx.branch.create({ data: { tenantId: outsider.id, code: 'test', name: 'Other arena', timeZone: 'Asia/Colombo' } });
      const outsiderGround = await tx.lane.create({ data: { tenantId: outsider.id, branchId: outsiderBranch.id, name: 'Other tenant ground', type: 'TURF_NET' } });
      const outsiderSlot = await tx.slotSchedule.create({ data: { tenantId: outsider.id, laneId: outsiderGround.id, startsAt: held[1].startsAt, endsAt: held[1].endsAt } });
      return { tenantId, admin, staff, branch, ground, held, mixed, cancel, wallet, race, gap, overlap, overlapExtra,
        crossGround, foreignGroundSlot, inactive, inactiveArena, maintenance, occupied, maximum, tooLong, tooMany,
        staffSlots, single, past, outsiderSlot };
    }, { timeout: 30_000 });

    async function login(email) { return (await request('/auth/login', null, { tenantSlug: slug, email, password }, 'POST', 200)).accessToken; }
    const admin = await login('admin@example.test');
    const staff = await login('staff@example.test');
    const customer = (await request('/auth/register', null, { tenantSlug: slug, email: 'player@example.test', displayName: 'Range test player', password })).accessToken;
    const other = (await request('/auth/register', null, { tenantSlug: slug, email: 'other-player@example.test', displayName: 'Other player', password })).accessToken;
    const profile = await get('/customers/me', customer);
    const ids = slots => slots.map(slot => slot.id);
    const rangeBody = slots => ({ slotIds: ids(slots), headcount: 4 });
    const book = (slots, token = customer, extra = {}) => request('/bookings', token, { ...rangeBody(slots), ...extra });
    async function grid(slots, token) {
      const startsAt = new Date(Math.min(...slots.map(slot => +slot.startsAt))).toISOString();
      const endsAt = new Date(Math.max(...slots.map(slot => +slot.endsAt))).toISOString();
      const query = new URLSearchParams({ startsAt, endsAt });
      return get((token ? '/branches/' : '/public/tenants/' + slug + '/branches/') + fixture.branch.id + '/availability?' + query, token);
    }
    function cellStatuses(result, slots, expected) {
      for (const slot of slots) assert.equal(result.slots.find(cell => cell.id === slot.id)?.status, expected, 'Incorrect status for base hour ' + slot.startsAt.toISOString());
    }
    async function reject(body, expected = 400, token = customer) {
      const beforeBookings = await prisma.booking.count({ where: { tenantId: fixture.tenantId } });
      const beforeRanges = await prisma.slotSchedule.count({ where: { tenantId: fixture.tenantId, isBookingRange: true } });
      await request('/bookings', token, body, 'POST', expected);
      assert.equal(await prisma.booking.count({ where: { tenantId: fixture.tenantId } }), beforeBookings, 'Rejected selection created a booking');
      assert.equal(await prisma.slotSchedule.count({ where: { tenantId: fixture.tenantId, isBookingRange: true } }), beforeRanges, 'Rejected selection left an aggregate schedule');
    }

    const before = await grid(fixture.held);
    cellStatuses(before, fixture.held, 'AVAILABLE');
    // Reverse input order to verify server sorting rather than relying on the client.
    const booking = await book([...fixture.held].reverse());
    assert.equal(Number(booking.totalAmount), 6000);
    assert.equal(booking.slot.startsAt, fixture.held[0].startsAt.toISOString());
    assert.equal(booking.slot.endsAt, fixture.held[1].endsAt.toISOString());
    assert.equal(await prisma.booking.count({ where: { tenantId: fixture.tenantId } }), 1);
    const combined = await prisma.slotSchedule.findUniqueOrThrow({ where: { id: booking.slotId } });
    assert.equal(combined.isBookingRange, true);
    assert.equal(+combined.endsAt - +combined.startsAt, 2 * hour);
    const heldGrid = await grid(fixture.held);
    cellStatuses(heldGrid, fixture.held, 'HELD');
    cellStatuses(await grid(fixture.held, admin), fixture.held, 'HELD');
    assert.deepEqual(heldGrid.slots.map(slot => slot.id).sort(), before.slots.map(slot => slot.id).sort());
    assert.equal(heldGrid.slots.some(slot => slot.id === combined.id), false);
    await request('/lanes/' + fixture.ground.id + '/slots/' + fixture.held[0].id, admin, undefined, 'DELETE', 409);
    assert.ok(await prisma.slotSchedule.findUnique({ where: { id: fixture.held[0].id } }));
    assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).slotId, combined.id);
    cellStatuses(await grid(fixture.held), fixture.held, 'HELD');
    for (const slot of heldGrid.slots) for (const field of ['booking', 'customerId', 'customerName', 'userId', 'leadOwnerId', 'tenantId', 'assignedStaff']) assert.equal(field in slot, false);
    assert.equal(JSON.stringify(heldGrid).includes('player@example.test'), false);
    await get('/bookings/' + booking.id, other, 404);
    const list = await get('/bookings?limit=100', customer);
    assert.equal(list.bookings.filter(entry => entry.id === booking.id).length, 1);
    assert.equal(list.bookings.find(entry => entry.id === booking.id).slot.endsAt, fixture.held[1].endsAt.toISOString());

    // A single transfer settles the aggregate, and invoice issuance is idempotent.
    const collectionBody = { amount: '6000', method: 'BANK_TRANSFER', idempotencyKey: randomUUID() };
    const collection = await request('/payments/' + booking.id + '/collections', staff, collectionBody);
    const collectionReplay = await request('/payments/' + booking.id + '/collections', staff, collectionBody);
    assert.equal(collectionReplay.transaction.id, collection.transaction.id);
    assert.equal(await prisma.paymentTransaction.count({ where: { bookingId: booking.id, type: 'COLLECTION' } }), 1);
    const settled = await get('/bookings/' + booking.id, customer);
    assert.equal(settled.status, 'CONFIRMED');
    assert.equal(settled.paymentStatus, 'FULLY_PAID');
    assert.equal(Number(settled.amountPaid), 6000);
    cellStatuses(await grid(fixture.held), fixture.held, 'PAID');
    const invoice = await request('/invoices/booking/' + booking.id, staff);
    assert.equal((await request('/invoices/booking/' + booking.id, staff)).id, invoice.id);
    const invoiceDetail = await get('/invoices/' + invoice.id, customer);
    assert.equal(Number(invoiceDetail.totalAmount), 6000);
    assert.equal(Number(invoiceDetail.amountDue), 0);
    assert.equal(invoiceDetail.settlementStatus, 'SETTLED');
    assert.equal(invoiceDetail.serviceStartsAt, fixture.held[0].startsAt.toISOString());
    assert.equal(invoiceDetail.serviceEndsAt, fixture.held[1].endsAt.toISOString());
    assert.equal(invoiceDetail.transactions.length, 1);
    assert.equal(invoiceDetail.transactions[0].method, 'BANK_TRANSFER');
    assert.equal(await prisma.invoice.count({ where: { bookingId: booking.id } }), 1);
    await get('/invoices/' + invoice.id, other, 404);

    const mixed = await book(fixture.mixed);
    assert.equal(Number(mixed.totalAmount), 7500, '19–20 at 3000 and 20–21 at 4500 must be summed');
    const staffBooking = await book(fixture.staffSlots, staff, { customerId: profile.id });
    assert.equal(staffBooking.leadOwnerId, fixture.staff.id);
    assert.equal(staffBooking.leadSource, 'WALK_IN');
    assert.equal(Number(staffBooking.totalAmount), 6000);
    // The established one-slot contract still references the original base schedule.
    const single = await request('/bookings', customer, { slotId: fixture.single[0].id, headcount: 2 });
    assert.equal(single.slotId, fixture.single[0].id);
    assert.equal(Number(single.totalAmount), 3000);

    await reject({ ...rangeBody(fixture.gap), slotId: fixture.gap[0].id });
    await reject({ headcount: 4 });
    await reject({ slotIds: [], headcount: 4 });
    await reject({ slotIds: null, headcount: 4 });
    await reject({ slotIds: fixture.gap[0].id, headcount: 4 });
    await reject({ slotIds: [fixture.gap[0].id, 'invalid-id'], headcount: 4 });
    await reject({ slotIds: [fixture.gap[0].id, fixture.gap[0].id], headcount: 4 });
    await reject(rangeBody([fixture.gap[0], fixture.gap[2]]));
    await reject(rangeBody([fixture.overlapExtra, fixture.overlap[1]]));
    await reject(rangeBody([fixture.crossGround[0], fixture.foreignGroundSlot]));
    await reject(rangeBody([fixture.held[0], fixture.outsiderSlot]), 404);
    await reject({ slotIds: [fixture.gap[0].id, randomUUID()], headcount: 4 }, 404);
    await reject(rangeBody(fixture.inactive), 409);
    await reject(rangeBody(fixture.inactiveArena), 409);
    await reject(rangeBody(fixture.past), 409);
    await reject(rangeBody(fixture.maintenance), 409);
    await request('/bookings', other, { slotId: fixture.occupied[1].id, headcount: 2 });
    await reject(rangeBody(fixture.occupied), 409);
    await reject(rangeBody(fixture.tooLong));
    await reject(rangeBody(fixture.tooMany));
    await reject({ slotId: combined.id, headcount: 4 }, 400);
    await reject({ slotIds: [combined.id], headcount: 4 }, 400);
    const maximum = await book(fixture.maximum);
    assert.equal(Number(maximum.totalAmount), 72000);
    assert.equal(Date.parse(maximum.slot.endsAt) - Date.parse(maximum.slot.startsAt), day);

    // Two overlapping ranges compete for the same lane lock. A failed transaction
    // must leave neither a second reservation nor an orphan aggregate schedule.
    const raceBefore = await prisma.booking.count({ where: { tenantId: fixture.tenantId } });
    const raceResults = await Promise.all([
      raw('/bookings', customer, rangeBody(fixture.race.slice(0, 2))),
      raw('/bookings', other, rangeBody(fixture.race.slice(1, 3))),
    ]);
    assert.deepEqual(raceResults.map(entry => entry.status).sort(), [201, 409]);
    assert.equal(await prisma.booking.count({ where: { tenantId: fixture.tenantId } }), raceBefore + 1);
    const raceRanges = await prisma.slotSchedule.findMany({ where: {
      tenantId: fixture.tenantId, laneId: fixture.ground.id, isBookingRange: true,
      startsAt: { gte: fixture.race[0].startsAt }, endsAt: { lte: fixture.race[2].endsAt },
    }, include: { _count: { select: { bookings: true } } } });
    assert.equal(raceRanges.length, 1);
    assert.equal(raceRanges[0]._count.bookings, 1);
    const winner = raceResults.find(entry => entry.status === 201).result;
    const raceGrid = await grid(fixture.race);
    const winningCells = fixture.race.filter(slot => +slot.startsAt >= Date.parse(winner.slot.startsAt) && +slot.endsAt <= Date.parse(winner.slot.endsAt));
    cellStatuses(raceGrid, winningCells, 'HELD');
    cellStatuses(raceGrid, fixture.race.filter(slot => !winningCells.includes(slot)), 'AVAILABLE');

    // Retrying a wallet-backed aggregate returns its original booking and debit,
    // even though those same hours are already occupied by that booking.
    await prisma.customer.update({ where: { id: profile.id }, data: { walletBalance: '12000' } });
    const walletKey = randomUUID();
    const wallet = await book(fixture.wallet, customer, { initialWalletPaymentKey: walletKey });
    const replay = await book([...fixture.wallet].reverse(), customer, { initialWalletPaymentKey: walletKey });
    assert.equal(replay.id, wallet.id);
    assert.equal(wallet.paymentStatus, 'FULLY_PAID');
    assert.equal(Number((await prisma.customer.findUniqueOrThrow({ where: { id: profile.id } })).walletBalance), 6000);
    assert.equal(await prisma.paymentTransaction.count({ where: { bookingId: wallet.id, method: 'WALLET', type: 'COLLECTION' } }), 1);
    cellStatuses(await grid(fixture.wallet), fixture.wallet, 'PAID');
    await reject({ ...rangeBody(fixture.single), initialWalletPaymentKey: walletKey }, 409);

    const cancelBefore = await grid(fixture.cancel);
    const cancellable = await book(fixture.cancel);
    const cancelled = await request('/bookings/' + cancellable.id + '/cancel', customer, { reason: 'Range cancellation test' });
    assert.equal(cancelled.status, 'CANCELLED');
    cellStatuses(await grid(fixture.cancel), fixture.cancel, 'AVAILABLE');
    const rebooked = await book(fixture.cancel, other);
    assert.notEqual(rebooked.id, cancellable.id);
    assert.equal(rebooked.slotId, cancellable.slotId, 'Rebooking should reuse the immutable aggregate schedule');
    await request('/bookings/' + rebooked.id + '/cancel', other, {});
    const cancelAfter = await grid(fixture.cancel);
    cellStatuses(cancelAfter, fixture.cancel, 'AVAILABLE');
    assert.deepEqual(cancelAfter.slots.map(slot => slot.id).sort(), cancelBefore.slots.map(slot => slot.id).sort());
    assert.equal(await prisma.slotSchedule.count({ where: {
      tenantId: fixture.tenantId, laneId: fixture.ground.id, isBookingRange: true,
      startsAt: fixture.cancel[0].startsAt, endsAt: fixture.cancel[1].endsAt,
    } }), 1);

    // A staff member may deliberately publish an existing hidden range as a
    // catalog option. Preserve the immutable schedule ID and its booking history.
    async function publishRange(slots, rangeId, expectedStatus) {
      const beforeGrid = await grid(slots);
      assert.equal(beforeGrid.slots.some(slot => slot.id === rangeId), false);
      const history = async () => JSON.stringify(await prisma.booking.findMany({
        where: { tenantId: fixture.tenantId, slotId: rangeId }, orderBy: { id: 'asc' },
        include: { payments: { orderBy: { id: 'asc' } }, invoice: true },
      }));
      const beforeHistory = await history();
      const body = { startsAt: slots[0].startsAt.toISOString(), endsAt: slots[slots.length - 1].endsAt.toISOString() };
      const published = await request('/lanes/' + fixture.ground.id + '/slots', admin, body);
      assert.equal(published.id, rangeId);
      assert.equal(published.isBookingRange, false);
      const afterGrid = await grid(slots);
      cellStatuses(afterGrid, slots, expectedStatus);
      assert.equal(afterGrid.slots.find(slot => slot.id === rangeId)?.status, expectedStatus);
      assert.deepEqual(afterGrid.slots.map(slot => slot.id).sort(), [...beforeGrid.slots.map(slot => slot.id), rangeId].sort());
      await request('/lanes/' + fixture.ground.id + '/slots', admin, body, 'POST', 409);
      assert.equal(await history(), beforeHistory, 'Publishing a range altered booking, payment or invoice history');
      assert.equal(await prisma.slotSchedule.count({ where: {
        tenantId: fixture.tenantId, laneId: fixture.ground.id,
        startsAt: slots[0].startsAt, endsAt: slots[slots.length - 1].endsAt, kind: 'BOOKABLE',
      } }), 1);
    }
    await publishRange(fixture.cancel, cancellable.slotId, 'AVAILABLE');
    // Publishing a paid session must continue to block both individual hours.
    await publishRange(fixture.held, booking.slotId, 'PAID');

    // Canceled history still protects both the base cells and the now-public
    // aggregate. Deleting a disjoint, unused adjacent cell remains supported.
    const cancelledHistory = async () => JSON.stringify(await prisma.booking.findMany({
      where: { tenantId: fixture.tenantId, slotId: cancellable.slotId }, orderBy: { id: 'asc' },
      include: { payments: { orderBy: { id: 'asc' } }, invoice: true },
    }));
    const protectedHistory = await cancelledHistory();
    for (const id of [fixture.cancel[0].id, cancellable.slotId]) {
      const original = await prisma.slotSchedule.findUniqueOrThrow({ where: { id } });
      await request('/lanes/' + fixture.ground.id + '/slots/' + id, admin, undefined, 'DELETE', 409);
      assert.deepEqual(await prisma.slotSchedule.findUniqueOrThrow({ where: { id } }), original);
    }
    assert.equal(await cancelledHistory(), protectedHistory, 'Rejected deletion changed booking history');
    cellStatuses(await grid(fixture.cancel), fixture.cancel, 'AVAILABLE');
    await request('/lanes/' + fixture.ground.id + '/slots/' + fixture.single[1].id, admin, undefined, 'DELETE', 204);
    assert.equal(await prisma.slotSchedule.findUnique({ where: { id: fixture.single[1].id } }), null);
    assert.ok(await prisma.slotSchedule.findUnique({ where: { id: fixture.single[0].id } }));

    console.log('Passed ' + checks + ' HTTP checks: consecutive ranges, mixed pricing, public hour blocking/privacy, single invoice/collection, input limits, overlapping races, wallet replay, cancellation, aggregate reuse, explicit catalog publication and history-safe schedule deletion.');
  } finally {
    try {
      await prisma.user.updateMany({ where: { tenant: { slug: { in: [slug, otherSlug] } } }, data: { isActive: false } });
    } finally {
      await app.close();
    }
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
