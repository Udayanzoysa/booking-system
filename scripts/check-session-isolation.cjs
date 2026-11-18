// Local-only verification; creates and removes one temporary, unbooked player.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

async function main() {
  const database = new URL(process.env.DATABASE_URL || '');
  if (!['localhost','127.0.0.1','[::1]'].includes(database.hostname) || database.pathname !== '/strikzclub_local') throw new Error('Use only the clean local strikzclub_local database.');
  const origin = process.env.STRIKZ_TEST_WEB_ORIGIN || 'http://127.0.0.1:32085';
  const url = new URL(origin);
  if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('Use a local web preview.');
  const prisma = new PrismaClient();
  const tenantSlug = 'strikzclub-homagama';
  const password = process.env.STRIKZ_TEST_PASSWORD;
  if (!password) throw new Error('Set STRIKZ_TEST_PASSWORD to the local admin test password.');
  const playerEmail = 'session-check-' + randomUUID() + '@example.test';
  const playerPassword = 'Check-' + randomUUID();
  const jar = new Map();
  let playerId;
  let checks = 0;
  function cookies() { return [...jar].map(([key,value]) => key + '=' + value).join('; '); }
  async function request(path, method = 'GET', body, expected = 200, cookie = cookies()) {
    const response = await fetch(origin + path, { method, redirect: 'manual', headers: { Origin: origin, Cookie: cookie, ...(body ? { 'Content-Type':'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    assert.equal(response.status, expected, method + ' ' + path + ': unexpected HTTP status');
    checks++;
    return response;
  }
  function remember(response) {
    const header = response.headers.get('set-cookie'); assert.ok(header);
    const [name,value] = header.split(';')[0].split('=');
    if (value) jar.set(name,value); else jar.delete(name);
    assert.ok(header.includes('HttpOnly')); assert.ok(header.includes('SameSite=lax'));
    return name;
  }
  try {
    const page = await request('/book'); assert.equal((await page.text()).includes('Staff dashboard'), false);
    await request('/icon.svg');
    await request('/dashboard', 'GET', undefined, 307);
    const staff = await request('/api/session', 'POST', { action:'login',tenantSlug,email:'admin@strikzclub.test',password });
    assert.equal(remember(staff), 'techwing-session');
    const staffId = (await staff.json()).principal.userId;
    await request('/dashboard/payments');
    await request('/api/session?scope=customer', 'GET', undefined, 401);
    const customer = await request('/api/session?scope=customer', 'POST', { action:'register',tenantSlug,email:playerEmail,password:playerPassword,displayName:'Temporary session check' });
    assert.equal(remember(customer), 'techwing-customer-session');
    playerId = (await customer.json()).principal.userId;
    assert.notEqual(playerId,staffId);
    assert.equal((await (await request('/api/session')).json()).principal.userId, staffId);
    assert.equal((await (await request('/api/session?scope=customer')).json()).principal.userId, playerId);
    const playerCookie = 'techwing-customer-session=' + jar.get('techwing-customer-session');
    await request('/dashboard', 'GET', undefined, 307, playerCookie);
    const forgedStaffCookie = await request('/dashboard', 'GET', undefined, 307, 'techwing-session=' + jar.get('techwing-customer-session'));
    assert.equal(forgedStaffCookie.headers.get('location'), '/book');
    assert.equal(remember(await request('/api/session?scope=customer', 'DELETE')), 'techwing-customer-session');
    assert.ok(jar.has('techwing-session'));
    await request('/api/session'); await request('/api/session?scope=customer', 'GET', undefined, 401);
    const customerAgain = await request('/api/session?scope=customer', 'POST', { action:'login',tenantSlug,email:playerEmail,password:playerPassword }); remember(customerAgain);
    assert.equal(remember(await request('/api/session', 'DELETE')), 'techwing-session');
    assert.ok(jar.has('techwing-customer-session'));
    await request('/api/session', 'GET', undefined, 401); await request('/api/session?scope=customer');
    await request('/api/session?scope=invalid', 'GET', undefined, 400);
    remember(await request('/api/session?scope=customer', 'DELETE'));
    console.log('Passed ' + checks + ' local HTTP checks: public booking page, favicon, dashboard protection, independent customer/staff cookies and logout isolation.');
  } finally {
    if (playerId) {
      const profile = await prisma.customer.findFirst({ where:{userId:playerId,user:{email:playerEmail}},select:{id:true,tenantId:true} });
      if (profile && await prisma.booking.count({where:{customerId:profile.id}}) === 0) {
        await prisma.$transaction(async tx => {
          await tx.userRole.deleteMany({where:{userId:playerId,tenantId:profile.tenantId}});
          await tx.customer.deleteMany({where:{id:profile.id,userId:playerId}});
          await tx.user.deleteMany({where:{id:playerId,email:playerEmail}});
        });
      }
    }
    await prisma.$disconnect();
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
