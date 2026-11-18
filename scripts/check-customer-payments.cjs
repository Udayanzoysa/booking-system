// Integration checks against a dedicated fixture tenant in the local sample DB.
// No request is sent to PayHere. Provider notifications are signed locally.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { createHash, randomUUID, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
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
  const slug = 'payment-check-' + randomUUID();
  const secret = randomUUID();
  const attachmentDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'strikz-payment-check-'));
  Object.assign(process.env, {
    PAYHERE_SANDBOX_ENABLED: '1', PAYHERE_TENANT_SLUG: slug,
    PAYHERE_MERCHANT_ID: 'TEST_ONLY_123', PAYHERE_MERCHANT_SECRET: secret,
    PAYHERE_NOTIFY_URL: 'https://example.test/api/payments/payhere/notify',
    PAYMENT_RETURN_ORIGIN: 'http://127.0.0.1:32085', TECHWING_QUICK_DEMO: '0',
    PAYMENT_SETTINGS_ENCRYPTION_KEY: randomBytes(32).toString('base64'), ATTACHMENTS_DIR: attachmentDirectory,
  });
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost)));
  await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl();
  const prisma = app.get(PrismaService);
  let publicSocket;
  const password = 'Payment-Check-' + randomUUID();
  const passwordHash = await hashPassword(password);
  let fixtureTenantId;
  let checks = 0;
  async function request(path, token, body, method = 'POST', expected = 201, contentType) {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    const multipart = body instanceof FormData;
    if (body !== undefined && !multipart) headers['Content-Type'] = contentType || 'application/json';
    const response = await fetch(origin + '/api' + path, {
      method, headers,
      body: body === undefined ? undefined : multipart ? body : contentType ? body.toString() : JSON.stringify(body),
    });
    const type = response.headers.get('content-type') || '';
    const result = type.includes('application/json') ? await response.json() : await response.arrayBuffer();
    assert.equal(response.status, expected, method + ' ' + path + ': ' + (result?.message || 'Unexpected HTTP status'));
    checks++;
    return result;
  }
  const get = (path, token, expected = 200) => request(path, token, undefined, 'GET', expected);
  try {
    const fixture = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { slug, name: 'Payment integration fixture', currency: 'LKR', unpaidHoldMinutes: 15 } });
      const tenantId = tenant.id;
      const permissions = await tx.permission.createManyAndReturn({ data: Object.values(PermissionCode).map(code => ({ tenantId, code })) });
      async function role(name, codes) {
        const entry = await tx.role.create({ data: { tenantId, name } });
        await tx.rolePermission.createMany({ data: permissions.filter(p => codes.includes(p.code)).map(p => ({ tenantId, roleId: entry.id, permissionId: p.id })) });
        return entry;
      }
      const adminRole = await role('Administrator', Object.values(PermissionCode));
      const staffRole = await role('Payment reviewer', [PermissionCode.RECORD_PAYMENT, PermissionCode.VIEW_BOOKINGS, PermissionCode.MANAGE_BOOKINGS, PermissionCode.CREATE_UNPAID_HOLD]);
      await role(WEB_CUSTOMER_ROLE_NAME, [PermissionCode.CREATE_UNPAID_HOLD]);
      async function user(email, roleId) {
        const entry = await tx.user.create({ data: { tenantId, email, displayName: email.split('@')[0], passwordHash } });
        await tx.userRole.create({ data: { tenantId, userId: entry.id, roleId } });
        return entry;
      }
      const admin = await user('admin@example.test', adminRole.id);
      await user('reviewer@example.test', staffRole.id);
      const branch = await tx.branch.create({ data: { tenantId, name: 'Test arena', code: 'test', timeZone: 'Asia/Colombo', webLeadOwnerId: admin.id } });
      const lane = await tx.lane.create({ data: { tenantId, branchId: branch.id, name: 'Test net', type: 'TURF_NET' } });
      await tx.lanePricingRule.createMany({ data: ['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'].map(dayOfWeek => ({ tenantId, laneId: lane.id, dayOfWeek, tier: 'OFF_PEAK', startMinute: 0, endMinute: 1440, pricePerHour: '3000' })) });
      const policy = await tx.cancellationPolicy.create({ data: { tenantId, name: 'Test policy' } });
      await tx.cancellationPolicyTier.create({ data: { tenantId, cancellationPolicyId: policy.id, minimumNoticeMinutes: 0, feeType: 'FREE' } });
      const start = new Date(); start.setUTCDate(start.getUTCDate() + 2); start.setUTCHours(8, 0, 0, 0);
      const slots = [];
      for (let i = 0; i < 8; i++) slots.push(await tx.slotSchedule.create({ data: { tenantId, laneId: lane.id, startsAt: new Date(+start + i*3600000), endsAt: new Date(+start + (i+1)*3600000) } }));
      const outsider = await tx.tenant.create({ data: { slug: slug + '-other', name: 'Other tenant', currency: 'LKR', unpaidHoldMinutes: 15 } });
      await tx.user.create({ data: { tenantId: outsider.id, email: 'outsider@example.test', displayName: 'Other tenant', passwordHash } });
      return { tenantId, branch, slots };
    });
    fixtureTenantId = fixture.tenantId;
    async function login(email, tenantSlug = slug) { return (await request('/auth/login', null, { tenantSlug, email, password }, 'POST', 200)).accessToken; }
    const admin = await login('admin@example.test');
    const staff = await login('reviewer@example.test');
    const outsider = await login('outsider@example.test', slug + '-other');
    const customer = (await request('/auth/register', null, { tenantSlug: slug, email: 'player@example.test', displayName: 'Payment test player', password })).accessToken;
    const other = (await request('/auth/register', null, { tenantSlug: slug, email: 'another@example.test', displayName: 'Another player', password })).accessToken;
    const { io } = require('../web/node_modules/socket.io-client');
    publicSocket = io(origin + '/availability', { auth: { tenantSlug: slug }, transports: ['websocket'], reconnection: false });
    await new Promise((resolve, reject) => { publicSocket.once('connect', resolve); publicSocket.once('connect_error', reject); });
    const rejectedSocket = io(origin + '/availability', { auth: { tenantSlug: slug, token: 'invalid-token' }, transports: ['websocket'], reconnection: false });
    await new Promise((resolve, reject) => { rejectedSocket.once('connect', () => reject(new Error('Invalid token fell back to public access'))); rejectedSocket.once('connect_error', resolve); });
    rejectedSocket.disconnect();
    await get('/payments/options', null, 401);
    await get('/payments/settings', customer, 403);
    await request('/payments/settings', staff, { bankTransferEnabled: false, bankName: '', accountName: '', accountNumber: '' }, 'PUT', 403);
    await request('/payments/settings', admin, { bankTransferEnabled: true, bankName: '', accountName: '', accountNumber: '' }, 'PUT', 400);
    const bank = { bankTransferEnabled: true, bankName: 'TEST BANK — DO NOT TRANSFER', accountName: 'Test fixture only', accountNumber: 'TEST-ONLY', bankBranch: 'Test', instructions: 'Integration test; no real transfers.' };
    const savedBank = await request('/payments/settings', admin, bank, 'PUT', 200);
    for (const [key, value] of Object.entries(bank)) assert.equal(savedBank[key], value);
    const gateway = { payhereEnabled: true, payhereSandbox: true, payhereMerchantId: 'TEST_ONLY_123', payhereMerchantSecret: secret,
      payhereNotifyUrl: 'https://example.test/api/payments/payhere/notify', payhereReturnOrigin: 'http://127.0.0.1:32085', contactPhone: '070 126 1966' };
    const savedGateway = await request('/payments/settings', admin, gateway, 'PUT', 200);
    assert.equal(savedGateway.payhereMerchantSecretConfigured, true);
    assert.equal(JSON.stringify(savedGateway).includes(secret), false);
    assert.equal('payhereMerchantSecretEncrypted' in savedGateway, false);
    const encrypted = (await prisma.paymentSettings.findUniqueOrThrow({ where: { tenantId: fixture.tenantId } })).payhereMerchantSecretEncrypted;
    assert.ok(encrypted.startsWith('v1.')); assert.ok(!encrypted.includes(secret));
    await request('/payments/settings', admin, { payhereMerchantSecret: '' }, 'PUT', 200);
    assert.equal((await prisma.paymentSettings.findUniqueOrThrow({ where: { tenantId: fixture.tenantId } })).payhereMerchantSecretEncrypted, encrypted);
    await request('/payments/settings', staff, { payhereEnabled: false }, 'PUT', 403);
    await request('/payments/settings', admin, { payhereSandbox: false }, 'PUT', 400);
    await request('/payments/settings', admin, { payhereNotifyUrl: 'http://localhost/notify' }, 'PUT', 400);
    await request('/payments/settings', admin, { payhereEnabled: false }, 'PUT', 200);
    assert.equal((await get('/payments/options', customer)).payhere.enabled, false);
    await request('/payments/settings', admin, { payhereEnabled: true }, 'PUT', 200);
    const options = await get('/payments/options', customer);
    assert.equal(options.bankTransfer.accountNumber, bank.accountNumber);
    assert.equal(options.payhere.enabled, true);
    assert.equal((await get('/payments/options', outsider)).payhere.enabled, false);
    async function book(index) { return request('/bookings', customer, { slotId: fixture.slots[index].id, headcount: 4 }); }
    const publicEvent = new Promise(resolve => publicSocket.once('availability.changed', (...args) => resolve(args)));
    const one = await book(0);
    assert.deepEqual(await publicEvent, []);
    const two = await book(1);
    const three = await book(2);
    const four = await book(3);
    const five = await book(4);
    const six = await book(5);
    const publicInfo = await get('/public/tenants/' + slug);
    assert.equal(publicInfo.contactPhone, '070 126 1966');
    assert.equal(publicInfo.branches.length, 1);
    const range = new URLSearchParams({ startsAt: fixture.slots[0].startsAt.toISOString(), endsAt: fixture.slots[7].endsAt.toISOString() });
    const publicPath = '/public/tenants/' + slug + '/branches/' + fixture.branch.id + '/availability?' + range;
    const publicSlots = await get(publicPath);
    assert.equal(publicSlots.slots.find(slot => slot.id === one.slotId).status, 'HELD');
    assert.equal(publicSlots.slots.find(slot => slot.id === fixture.slots[7].id).status, 'AVAILABLE');
    for (const slot of publicSlots.slots) for (const field of ['booking','customerId','customerName','userId','leadOwnerId','tenantId','assignedStaff']) assert.equal(field in slot, false);
    assert.equal(JSON.stringify(publicSlots).includes('player@example.test'), false);
    await get('/public/tenants/' + slug + '-other/branches/' + fixture.branch.id + '/availability?' + range, null, 404);
    await request('/bookings', other, { slotId: fixture.slots[0].id, headcount: 2 }, 'POST', 409);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
    function uploadForm(key = randomUUID(), amount = '3000', bytes = png, type = 'image/png') {
      const form = new FormData(); form.set('amount', amount); form.set('reference', 'TEST'); form.set('idempotencyKey', key); form.set('attachment', new Blob([bytes], { type }), 'test-slip.png'); return form;
    }
    await request('/payments/' + one.id + '/bank-transfer-slips', other, uploadForm(), 'POST', 404);
    await request('/payments/' + one.id + '/bank-transfer-slips', customer, uploadForm(randomUUID(), '3000', Buffer.from('<html>not png</html>')), 'POST', 400);
    await request('/payments/' + one.id + '/bank-transfer-slips', customer, uploadForm(randomUUID(), '4000'), 'POST', 400);
    await request('/payments/' + one.id + '/bank-transfer-slips', customer, uploadForm(randomUUID(), '1000'), 'POST', 400);
    await request('/payments/' + one.id + '/bank-transfer-slips', customer, uploadForm(randomUUID(), '3000', Buffer.alloc(5*1024*1024+1)), 'POST', 413);
    const key = randomUUID();
    const slip = await request('/payments/' + one.id + '/bank-transfer-slips', customer, uploadForm(key));
    assert.equal(slip.status, 'PENDING'); assert.equal('attachment' in slip, false);
    const stored = await prisma.bankTransferSlip.findUniqueOrThrow({ where: { id: slip.id } });
    assert.equal(stored.attachment, null);
    assert.ok(stored.storagePath.startsWith('bookings/' + one.id + '/'));
    assert.ok(fs.readFileSync(path.join(attachmentDirectory, stored.storagePath)).equals(png));
    assert.equal('storagePath' in slip, false);
    assert.equal((await get('/bookings/' + one.id, customer)).amountPaid, '0');
    assert.equal((await request('/payments/' + one.id + '/bank-transfer-slips', customer, uploadForm(key))).id, slip.id);
    await request('/payments/' + one.id + '/bank-transfer-slips', customer, uploadForm(), 'POST', 409);
    await get('/payments/bank-transfer-slips/' + slip.id + '/attachment', other, 404);
    await get('/payments/bank-transfer-slips/' + slip.id + '/attachment', outsider, 404);
    assert.equal(Buffer.from(await get('/payments/bank-transfer-slips/' + slip.id + '/attachment', customer)).equals(png), true);
    await get('/payments/bank-transfer-slips/' + slip.id + '/attachment', staff);
    await get('/payments/bank-transfer-slips', customer, 403);
    assert.equal((await get('/payments/bank-transfer-slips?status=PENDING', staff)).length, 1);
    await request('/payments/bank-transfer-slips/' + slip.id + '/review', customer, { decision: 'APPROVED' }, 'POST', 403);
    const approvals = await Promise.all([1,2].map(() => request('/payments/bank-transfer-slips/' + slip.id + '/review', staff, { decision: 'APPROVED', note: 'Verified test transfer' })));
    assert.equal(approvals.every(entry => entry.status === 'APPROVED'), true);
    const settled = await get('/bookings/' + one.id, customer);
    assert.equal(settled.status, 'CONFIRMED'); assert.equal(settled.paymentStatus, 'FULLY_PAID'); assert.equal(settled.amountPaid, '3000');
    assert.equal(await prisma.paymentTransaction.count({ where: { bookingId: one.id } }), 1);
    const afterPaid = await get(publicPath);
    assert.equal(afterPaid.slots.find(slot => slot.id === one.slotId).status, 'PAID');
    const playerProfile = await get('/customers/me', customer);
    const staffBooking = await request('/bookings', staff, { slotId: fixture.slots[6].id, headcount: 4, customerId: playerProfile.id });
    assert.equal(staffBooking.leadSource, 'WALK_IN');
    const staffPrincipal = await get('/auth/me', staff);
    assert.equal(staffBooking.leadOwnerId, staffPrincipal.userId);
    const adminPrincipal = await get('/auth/me', admin);
    await request('/bookings', staff, { slotId: fixture.slots[7].id, headcount: 4, customerId: playerProfile.id, leadOwnerId: adminPrincipal.userId }, 'POST', 400);
    const depositBooking = await request('/bookings', admin, { slotId: fixture.slots[7].id, headcount: 4, customerId: playerProfile.id, leadOwnerId: staffPrincipal.userId, depositRequired:'1000', initialPayment:{amount:'1000',method:'CASH',idempotencyKey:randomUUID()} });
    assert.equal(depositBooking.leadOwnerId,staffPrincipal.userId);
    assert.equal(depositBooking.paymentStatus,'DEPOSIT_PAID');
    assert.equal((await get(publicPath)).slots.find(slot=>slot.id===fixture.slots[7].id).status,'RESERVED');
    const approvedForm = uploadForm(); approvedForm.set('reviewDecision', 'APPROVED');
    const staffSlip = await request('/payments/' + staffBooking.id + '/bank-transfer-slips', staff, approvedForm);
    assert.equal(staffSlip.status, 'APPROVED');
    assert.equal((await get('/bookings/' + staffBooking.id, customer)).paymentStatus, 'FULLY_PAID');
    assert.equal(await prisma.paymentTransaction.count({ where: { bookingId: staffBooking.id } }), 1);
    const customerBookings = await get('/bookings?limit=30', customer);
    assert.equal(customerBookings.bookings.find(booking=>booking.id===one.id).latestBankTransferSlip.status, 'APPROVED');
    assert.equal((await get('/bookings?limit=30', other)).bookings.length,0);
    await prisma.bankTransferSlip.update({where:{id:slip.id},data:{storagePath:null,attachment:new Uint8Array(png)}});
    assert.ok(Buffer.from(await get('/payments/bank-transfer-slips/' + slip.id + '/attachment', customer)).equals(png));
    await prisma.bankTransferSlip.update({where:{id:slip.id},data:{storagePath:stored.storagePath,attachment:null}});
    const forgedApproval = uploadForm(); forgedApproval.set('reviewDecision', 'APPROVED');
    await request('/payments/' + two.id + '/bank-transfer-slips', customer, forgedApproval, 'POST', 403);
    const rejected = await request('/payments/' + two.id + '/bank-transfer-slips', customer, uploadForm());
    await request('/payments/bank-transfer-slips/' + rejected.id + '/review', staff, { decision: 'REJECTED', note: 'Test rejection' });
    assert.equal((await get('/bookings/' + two.id, customer)).amountPaid, '0');
    const expired = await request('/payments/' + six.id + '/bank-transfer-slips', customer, uploadForm());
    await prisma.booking.update({ where: { id: six.id }, data: { holdExpiresAt: new Date(Date.now()-1000) } });
    await request('/payments/bank-transfer-slips/' + expired.id + '/review', staff, { decision: 'APPROVED' }, 'POST', 409);
    await request('/payments/bank-transfer-slips/' + expired.id + '/review', staff, { decision: 'REJECTED' });
    const checkoutKey = randomUUID();
    await request('/payments/' + three.id + '/payhere', other, { idempotencyKey: randomUUID(), billingAddress: '1 Test Road', billingCity: 'Colombo', billingPhone: '+94700000000' }, 'POST', 404);
    const checkout = await request('/payments/' + three.id + '/payhere', customer, { idempotencyKey: checkoutKey, billingAddress: '1 Test Road', billingCity: 'Colombo', billingPhone: '+94700000000' });
    assert.equal(checkout.url, 'https://sandbox.payhere.lk/pay/checkout');
    assert.equal((await request('/payments/' + three.id + '/payhere', customer, { idempotencyKey: checkoutKey, billingAddress: '1 Test Road', billingCity: 'Colombo', billingPhone: '+94700000000' })).fields.order_id, checkout.fields.order_id);
    const md5 = value => createHash('md5').update(value).digest('hex').toUpperCase();
    assert.equal(checkout.fields.hash, md5(checkout.fields.merchant_id + checkout.fields.order_id + checkout.fields.amount + checkout.fields.currency + md5(secret)));
    function notification(entry, overrides = {}) {
      const fields = { merchant_id: entry.fields.merchant_id, order_id: entry.fields.order_id, payment_id: randomUUID(), payhere_amount: entry.fields.amount, payhere_currency: entry.fields.currency, status_code: '2', ...overrides };
      fields.md5sig = md5(fields.merchant_id + fields.order_id + fields.payhere_amount + fields.payhere_currency + fields.status_code + md5(secret));
      return fields;
    }
    const notify = (fields, expected = 200) => request('/payments/payhere/notify', null, new URLSearchParams(fields), 'POST', expected, 'application/x-www-form-urlencoded');
    await notify({ ...notification(checkout), md5sig: '0'.repeat(32) }, 401);
    await notify(notification(checkout, { payhere_amount: '1.00' }), 400);
    await notify(notification(checkout, { payhere_currency: 'USD' }), 400);
    const success = notification(checkout);
    await request('/payments/settings', admin, { payhereEnabled: false, payhereMerchantId: 'ROTATED_TEST_MERCHANT', payhereMerchantSecret: randomUUID() }, 'PUT', 200);
    const notifications = await Promise.all([notify(success), notify(success)]);
    assert.equal(notifications.every(entry => entry.status === 'SUCCEEDED'), true);
    assert.equal((await get('/bookings/' + three.id, customer)).paymentStatus, 'FULLY_PAID');
    assert.equal(await prisma.paymentTransaction.count({ where: { bookingId: three.id } }), 1);
    await request('/payments/settings', admin, gateway, 'PUT', 200);
    const late = await request('/payments/' + four.id + '/payhere', customer, { idempotencyKey: randomUUID(), billingAddress: '1 Test Road', billingCity: 'Colombo', billingPhone: '+94700000000' });
    await request('/bookings/' + four.id + '/cancel', customer, {});
    assert.equal((await notify(notification(late))).status, 'REVIEW');
    assert.equal((await get('/bookings/' + four.id, customer)).amountPaid, '0');
    const changed = await request('/payments/' + five.id + '/payhere', customer, { idempotencyKey: randomUUID(), billingAddress: '1 Test Road', billingCity: 'Colombo', billingPhone: '+94700000000' });
    await request('/payments/' + five.id + '/collections', staff, { amount: '3000', method: 'CASH', idempotencyKey: randomUUID() });
    assert.equal((await notify(notification(changed))).status, 'REVIEW');
    assert.equal(await prisma.paymentTransaction.count({ where: { bookingId: five.id } }), 1);
    const invoice = await request('/invoices/booking/' + one.id, admin);
    const detail = await get('/invoices/' + invoice.id, customer);
    assert.equal(Number(detail.amountDue), 0);
    assert.equal(detail.settlementStatus, 'SETTLED');
    const { readSlipAttachment } = require('../dist/payments/slip-storage');
    await assert.rejects(() => readSlipAttachment('../outside.pdf', 10));
    const { decryptPaymentSecret } = require('../dist/payments/payment-secrets');
    assert.throws(() => decryptPaymentSecret(randomUUID(), encrypted));
    console.log('Passed ' + checks + ' HTTP checks: public calendar privacy, staff attribution, encrypted admin gateway settings, private folder uploads, duplicate review, reject/expiry, verified callbacks, and invoice balances.');
  } finally {
    if (fixtureTenantId) await prisma.user.updateMany({ where: { tenant: { slug: { in: [slug, slug + '-other'] } } }, data: { isActive: false } });
    publicSocket?.disconnect();
    await app.close();
    const resolvedTemp = path.resolve(attachmentDirectory);
    if (path.dirname(resolvedTemp) === path.resolve(os.tmpdir()) && path.basename(resolvedTemp).startsWith('strikz-payment-check-')) fs.rmSync(resolvedTemp, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
