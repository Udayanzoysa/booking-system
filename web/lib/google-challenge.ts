import 'server-only';

import { timingSafeEqual } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { SessionServiceError } from './server-auth';

export const googleChallengeCookieName = 'techwing-google-challenge';
export const googleChallengeLifetimeMs = 10 * 60_000;

export function requestOrigin(request: NextRequest): string {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const protocol = request.headers.get('x-forwarded-proto');
  return host && protocol && ['http', 'https'].includes(protocol) ? `${protocol}://${host}` : request.nextUrl.origin;
}

export function secureCookie(request: NextRequest): boolean {
  return request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
}

export function clearGoogleChallenge(response: NextResponse, request: NextRequest): NextResponse {
  response.cookies.set(googleChallengeCookieName, '', {
    httpOnly: true, secure: secureCookie(request), sameSite: 'lax', path: '/api', maxAge: 0,
  });
  return response;
}

export function verifyGoogleChallenge(request: NextRequest, tenantSlug: unknown, nonce: unknown): void {
  if (typeof tenantSlug !== 'string' || typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) {
    throw new SessionServiceError(403, 'Google sign-in has expired. Choose Continue with Google again.');
  }
  let challenge: { nonce?: unknown; tenantSlug?: unknown; expiresAt?: unknown };
  try {
    const cookie = request.cookies.get(googleChallengeCookieName)?.value;
    if (!cookie || cookie.length > 1024) throw new Error();
    challenge = JSON.parse(Buffer.from(cookie, 'base64url').toString('utf8')) as typeof challenge;
  } catch { throw new SessionServiceError(403, 'Google sign-in has expired. Choose Continue with Google again.'); }
  if (!challenge || typeof challenge.nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(challenge.nonce)
    || challenge.tenantSlug !== tenantSlug || typeof challenge.expiresAt !== 'number'
    || !Number.isSafeInteger(challenge.expiresAt) || challenge.expiresAt <= Date.now()
    || challenge.expiresAt > Date.now() + googleChallengeLifetimeMs
    || !timingSafeEqual(Buffer.from(challenge.nonce), Buffer.from(nonce))) {
    throw new SessionServiceError(403, 'Google sign-in has expired. Choose Continue with Google again.');
  }
}
