// Local HTTP checks for the Google nonce/cookie bridge; no Google account is used.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');

async function main() {
  const origin = process.env.STRIKZ_TEST_WEB_ORIGIN || 'http://127.0.0.1:32085';
  if (!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)) throw new Error('Use a local web preview.');
  const tenantSlug = 'strikzclub-homagama';
  let checks = 0;
  async function request(path, { method = 'GET', body, cookie = '', headers = {}, expected = 200 } = {}) {
    const response = await fetch(origin + path, { method, redirect:'manual', headers:{Origin:origin,Cookie:cookie,...(body ? {'Content-Type':'application/json'} : {}),...headers},body:body ? JSON.stringify(body) : undefined });
    assert.equal(response.status,expected,method+' '+path+': unexpected HTTP status'); checks++;
    return response;
  }
  await request('/api/google-sign-in',{expected:400});
  await request('/api/google-sign-in?tenant=invalid%2Fslug',{expected:400});
  await request('/api/google-sign-in?tenant='+tenantSlug,{headers:{Origin:'https://example.test'},expected:403});
  await request('/api/google-sign-in?tenant='+tenantSlug,{headers:{'Sec-Fetch-Site':'cross-site'},expected:403});
  const challenge = await request('/api/google-sign-in?tenant='+tenantSlug);
  const config = await challenge.json();
  assert.equal(config.enabled,true); assert.ok(config.clientId.endsWith('.apps.googleusercontent.com')); assert.match(config.nonce,/^[A-Za-z0-9_-]{43}$/);
  assert.ok(challenge.headers.get('cache-control').includes('no-store'));
  const setCookie = challenge.headers.get('set-cookie'); assert.ok(setCookie.includes('HttpOnly')); assert.ok(setCookie.includes('SameSite=lax')); assert.ok(setCookie.includes('Path=/api'));
  const cookie = setCookie.split(';')[0];
  const body = {action:'google',tenantSlug,nonce:config.nonce,credential:'short'};
  const post = (overrides={},options={}) => request('/api/session?scope=customer',{method:'POST',body:{...body,...overrides},cookie,...options});
  await post({}, {cookie:'',expected:403});
  await post({nonce:randomBytes(32).toString('base64url')},{expected:403});
  await post({tenantSlug:'another-arena'},{expected:403});
  const expired = Buffer.from(JSON.stringify({tenantSlug,nonce:config.nonce,expiresAt:Date.now()-1})).toString('base64url');
  await post({}, {cookie:'techwing-google-challenge='+expired,expected:403});
  await post({}, {headers:{Origin:'https://example.test'},expected:403});
  await request('/api/session',{method:'POST',body,cookie,expected:403});
  const invalidCredential = await post({}, {expected:400});
  assert.ok(invalidCredential.headers.get('set-cookie').includes('techwing-google-challenge=;'));
  assert.ok(invalidCredential.headers.get('set-cookie').includes('Max-Age=0'));
  assert.equal(invalidCredential.headers.get('set-cookie').includes('techwing-session='),false);
  assert.equal(invalidCredential.headers.get('set-cookie').includes('techwing-customer-session='),false);
  await post({action:'link-google'}, {expected:401});
  console.log('Passed '+checks+' Google session HTTP checks: configured client, HttpOnly challenge, tenant/nonce/expiry/origin rejection, customer-only scope, and challenge cleanup. No real Google login was used.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
