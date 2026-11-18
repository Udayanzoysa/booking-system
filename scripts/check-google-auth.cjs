// Local-only integration checks. Google's certificate discovery is replaced with
// an ephemeral RSA public key; Google's real JWT verifier and app claim checks run.
// No request is sent to Google, and no test ID/access token is printed.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { generateKeyPairSync, randomBytes, randomUUID, sign } = require('node:crypto');
const { NestFactory, HttpAdapterHost } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { AppModule } = require('../dist/app.module');
const { GoogleIdentityVerifier } = require('../dist/auth/google-identity-verifier');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { PrismaExceptionFilter } = require('../dist/prisma/prisma-exception.filter');
const { PermissionCode, WEB_CUSTOMER_ROLE_NAME } = require('../dist/rbac/permissions');
const { hashPassword } = require('../dist/auth/password');
const { requireSampleDatabase } = require('../dist/sample-database');

async function main() {
  requireSampleDatabase();
  const clientId = '123456789-local-check.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_ID = clientId;
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const alienKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const cert = publicKey.export({ type: 'spki', format: 'pem' });
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost)));
  const verifier = app.get(GoogleIdentityVerifier);
  verifier.client.getFederatedSignonCertsAsync = async () => ({ certs: { 'local-check-key': cert }, format: 'PEM' });
  await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl();
  const prisma = app.get(PrismaService);
  const slug = 'google-check-' + randomUUID();
  const password = 'Google-Check-' + randomUUID();
  const passwordHash = await hashPassword(password);
  const nonce = randomBytes(32).toString('base64url');
  let checks = 0;
  let fixtureIds = [];
  async function request(path, token, body, expected = 200, method = 'POST') {
    const response = await fetch(origin + '/api' + path, {
      method,
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json().catch(() => null);
    assert.equal(response.status, expected, method + ' ' + path + ': ' + (result?.message || 'Unexpected HTTP status'));
    checks++;
    return result;
  }
  const get = (path, token, expected = 200) => request(path, token, undefined, expected, 'GET');
  function credential(overrides = {}, key = privateKey, header = {}) {
    const now = Math.floor(Date.now() / 1000);
    const payload = { iss: 'https://accounts.google.com', aud: clientId, iat: now, exp: now + 3600,
      sub: 'google-new-player', email: 'google-player@example.test', email_verified: true,
      name: 'Google Test Player', nonce, ...overrides };
    const first = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'local-check-key', ...header })).toString('base64url');
    const second = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const input = first + '.' + second;
    return input + '.' + sign('RSA-SHA256', Buffer.from(input), key).toString('base64url');
  }
  const google = (overrides = {}, extra = {}) => ({ tenantSlug: slug, nonce, credential: credential(overrides), ...extra });
  async function login(email, tenantSlug = slug) {
    return (await request('/auth/login', null, { tenantSlug, email, password })).accessToken;
  }
  async function principal(token) { return get('/auth/me', token); }
  try {
    const fixture = await prisma.$transaction(async tx => {
      async function tenant(tenantSlug) {
        const entry = await tx.tenant.create({ data: { slug: tenantSlug, name: 'Google sign-in test', currency: 'LKR', unpaidHoldMinutes: 15 } });
        const tenantId = entry.id;
        const permissions = await tx.permission.createManyAndReturn({ data: Object.values(PermissionCode).map(code => ({ tenantId, code })) });
        const adminRole = await tx.role.create({ data: { tenantId, name: 'Administrator' } });
        const customerRole = await tx.role.create({ data: { tenantId, name: WEB_CUSTOMER_ROLE_NAME } });
        await tx.rolePermission.createMany({ data: permissions.flatMap(({id: permissionId, code}) => [
          {tenantId,permissionId,roleId:adminRole.id},
          ...(code === PermissionCode.CREATE_UNPAID_HOLD ? [{tenantId,permissionId,roleId:customerRole.id}] : []),
        ]) });
        const admin = await tx.user.create({ data: { tenantId, email: 'admin@example.test', displayName: 'Test Administrator', passwordHash } });
        await tx.userRole.create({ data: { tenantId, userId: admin.id, roleId: adminRole.id } });
        return { tenantId, admin, adminRole, customerRole };
      }
      return { first: await tenant(slug), second: await tenant(slug + '-other') };
    });
    fixtureIds = [fixture.first.tenantId, fixture.second.tenantId];
    assert.deepEqual(await get('/auth/google/config'), { enabled: true, clientId });
    const admin = await login('admin@example.test');
    const passwordCustomer = (await request('/auth/register', null, { tenantSlug: slug, email: 'password-player@example.test', displayName: 'Password Player', password }, 201)).accessToken;
    const differentCustomer = (await request('/auth/register', null, { tenantSlug: slug, email: 'different-player@example.test', displayName: 'Different Player', password }, 201)).accessToken;
    const originalProfile = await get('/customers/me', passwordCustomer);
    assert.equal(originalProfile.googleLinked, false);

    // The real Google library rejects wrong signatures, issuer, audience, and expired JWTs.
    await request('/auth/google', null, google({}, { credential: credential({}, alienKeys.privateKey) }), 401);
    await request('/auth/google', null, google({ aud: 'another-client.apps.googleusercontent.com' }), 401);
    await request('/auth/google', null, google({ iss: 'https://attacker.example' }), 401);
    await request('/auth/google', null, google({ exp: Math.floor(Date.now()/1000) - 600 }), 401);
    await request('/auth/google', null, google({ exp: Math.floor(Date.now()/1000) - 1 }), 401);
    await request('/auth/google', null, google({ email_verified: false }), 401);
    await request('/auth/google', null, google({ email_verified: 'true' }), 401);
    await request('/auth/google', null, google({ email: 'not-an-email' }), 401);
    await request('/auth/google', null, google({ sub: '' }), 401);
    await request('/auth/google', null, google({ nonce: randomBytes(32).toString('base64url') }), 401);
    await request('/auth/google', null, google({}, { nonce: 'too-short' }), 400);
    await request('/auth/google', null, google({}, { credential: 'malformed-token'.repeat(10) }), 401);
    await request('/auth/google', null, google({}, { tenantSlug: slug + '-missing' }), 404);
    const unchangedCount = await prisma.user.count({ where: { tenantId: fixture.first.tenantId } });
    assert.equal(unchangedCount, 3);
    delete process.env.GOOGLE_CLIENT_ID;
    assert.deepEqual(await get('/auth/google/config'), { enabled: false });
    await request('/auth/google', null, google(), 503);
    process.env.GOOGLE_CLIENT_ID = clientId;

    const first = await request('/auth/google', null, google());
    assert.equal(first.tokenType, 'Bearer');
    const firstPrincipal = await principal(first.accessToken);
    assert.deepEqual(firstPrincipal.permissions, [PermissionCode.CREATE_UNPAID_HOLD]);
    assert.equal(firstPrincipal.tenantId, fixture.first.tenantId);
    const firstUser = await prisma.user.findUniqueOrThrow({ where:{id:firstPrincipal.userId} });
    assert.equal(firstUser.googleSubject, 'google-new-player');
    assert.equal(firstUser.passwordHash, null);
    const firstProfile = await get('/customers/me', first.accessToken);
    assert.equal(firstProfile.googleLinked,true);
    assert.equal(firstProfile.name,'Google Test Player');
    assert.equal('googleSubject' in firstProfile,false);
    assert.equal(await prisma.customer.count({ where:{tenantId:fixture.first.tenantId,userId:firstUser.id} }),1);
    const again = await request('/auth/google', null, google());
    assert.equal((await principal(again.accessToken)).userId,firstUser.id);
    const concurrent = await Promise.all([request('/auth/google', null, google({sub:'google-race',email:'race@example.test'})),request('/auth/google', null, google({sub:'google-race',email:'race@example.test'}))]);
    assert.equal((await principal(concurrent[0].accessToken)).userId,(await principal(concurrent[1].accessToken)).userId);
    await request('/auth/login', null, {tenantSlug:slug,email:'google-player@example.test',password},401);
    await get('/users',first.accessToken,403);
    await get('/rbac/roles',first.accessToken,403);

    // A valid Google email never silently takes over a password account or staff login.
    const passwordIdentity = google({sub:'google-password-player',email:'password-player@example.test'});
    await request('/auth/google',null,passwordIdentity,409);
    await request('/auth/google/link',null,passwordIdentity,401);
    await request('/auth/google/link',differentCustomer,passwordIdentity,403);
    await request('/auth/google/link',admin,google({sub:'google-admin',email:'admin@example.test'}),403);
    await request('/auth/google',null,google({sub:'google-admin',email:'admin@example.test'}),403);
    await request('/auth/google/link',passwordCustomer,google({sub:'google-password-player',email:'password-player@example.test'},{tenantSlug:slug+'-other'}),403);
    const linked = await request('/auth/google/link',passwordCustomer,passwordIdentity);
    assert.equal((await principal(linked.accessToken)).userId,originalProfile.userId);
    const linkedAgain = await request('/auth/google',null,passwordIdentity);
    assert.equal((await principal(linkedAgain.accessToken)).userId,originalProfile.userId);
    await login('password-player@example.test');
    assert.equal((await get('/customers/me',linkedAgain.accessToken)).googleLinked,true);
    await request('/auth/google',null,google({sub:'another-google-subject',email:'password-player@example.test'}),409);
    await request('/auth/google/link',passwordCustomer,google({sub:'replacement-google-subject',email:'password-player@example.test'}),409);

    // Provider subjects are stable identifiers and are isolated to an arena.
    const otherTenant = await request('/auth/google',null,google({}, {tenantSlug:slug+'-other'}));
    const otherPrincipal = await principal(otherTenant.accessToken);
    assert.equal(otherPrincipal.tenantId,fixture.second.tenantId);
    assert.notEqual(otherPrincipal.userId,firstUser.id);
    const changedEmail = await request('/auth/google',null,google({email:'changed-provider-email@example.test'}));
    assert.equal((await principal(changedEmail.accessToken)).userId,firstUser.id);
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:firstUser.id}})).email,'google-player@example.test');
    await prisma.user.update({where:{id:firstUser.id},data:{isActive:false}});
    await request('/auth/google',null,google(),401);
    await prisma.user.update({where:{id:firstUser.id},data:{isActive:true}});
    await prisma.userRole.create({data:{tenantId:fixture.first.tenantId,userId:firstUser.id,roleId:fixture.first.adminRole.id}});
    await request('/auth/google',null,google(),403);
    await get('/auth/me',first.accessToken,401);
    await get('/users',first.accessToken,401);
    console.log('Passed ' + checks + ' Google auth HTTP checks: real local RSA verification, nonce/audience/expiry/issuer rejection, customer creation, explicit linking, tenant isolation, account replay, and staff protection. No Google network or real Google login was used.');
  } finally {
    if (fixtureIds.length) await prisma.user.updateMany({where:{tenantId:{in:fixtureIds}},data:{isActive:false}});
    await app.close();
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
