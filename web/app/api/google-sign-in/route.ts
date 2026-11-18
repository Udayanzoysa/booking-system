import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { authRequest, SessionServiceError } from '../../../lib/server-auth';
import { clearGoogleChallenge, googleChallengeCookieName, googleChallengeLifetimeMs, requestOrigin, secureCookie } from '../../../lib/google-challenge';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (origin && origin !== requestOrigin(request) || fetchSite === 'cross-site') {
    return NextResponse.json({ message: 'This Google sign-in request is not allowed.' }, { status: 403, headers });
  }
  const tenantSlug = request.nextUrl.searchParams.get('tenant');
  if (!tenantSlug || tenantSlug.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenantSlug)) {
    return NextResponse.json({ message: 'Choose a valid arena for Google sign-in.' }, { status: 400, headers });
  }
  try {
    const config = await authRequest<{ enabled: boolean; clientId?: string }>('/auth/google/config', { method: 'GET' });
    if (!config.enabled || typeof config.clientId !== 'string' || !config.clientId.endsWith('.apps.googleusercontent.com')) {
      return clearGoogleChallenge(NextResponse.json({ enabled: false }, { headers }), request);
    }
    const nonce = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + googleChallengeLifetimeMs;
    const response = NextResponse.json({ enabled: true, clientId: config.clientId, nonce }, { headers });
    response.cookies.set(googleChallengeCookieName, Buffer.from(JSON.stringify({ nonce, tenantSlug, expiresAt })).toString('base64url'), {
      httpOnly: true, secure: secureCookie(request), sameSite: 'lax', path: '/api',
      maxAge: googleChallengeLifetimeMs / 1000,
    });
    return response;
  } catch (cause) {
    const status = cause instanceof SessionServiceError ? cause.status : 503;
    return clearGoogleChallenge(NextResponse.json({ message: cause instanceof Error ? cause.message : 'Google sign-in is unavailable. Try email sign-in.' }, { status, headers }), request);
  }
}
