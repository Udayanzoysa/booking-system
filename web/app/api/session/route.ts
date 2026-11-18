import { NextRequest, NextResponse } from 'next/server';
import { authRequest, cookieForScope, readSession, SessionServiceError, validateSession, type SessionScope } from '../../../lib/server-auth';
import { clearGoogleChallenge, verifyGoogleChallenge } from '../../../lib/google-challenge';

export const dynamic = 'force-dynamic';

const responseHeaders = { 'Cache-Control': 'private, no-store' };

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const forwardedHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedHost && forwardedProto && ['http', 'https'].includes(forwardedProto)) {
    return origin === `${forwardedProto}://${forwardedHost}`;
  }
  return origin === request.nextUrl.origin;
}

function scopeOf(request: NextRequest): SessionScope {
  const scope = request.nextUrl.searchParams.get('scope');
  if (scope && !['staff', 'customer'].includes(scope)) throw new SessionServiceError(400, 'Choose a staff or customer session.');
  return scope === 'customer' ? 'customer' : 'staff';
}

function clearSession(response: NextResponse, scope: SessionScope) {
  response.cookies.set(cookieForScope(scope), '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return response;
}

function failure(error: unknown) {
  const status = error instanceof SessionServiceError ? error.status : 503;
  const message = error instanceof SessionServiceError ? error.message : 'Could not complete sign-in.';
  return NextResponse.json({ message }, { status, headers: responseHeaders });
}

export async function GET(request: NextRequest) {
  try {
    const scope = scopeOf(request);
    const auth = await readSession(scope);
    if (!auth) return clearSession(NextResponse.json({ message: 'Sign in to continue.' }, { status: 401, headers: responseHeaders }), scope);
    return NextResponse.json(auth, { headers: responseHeaders });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ message: 'This sign-in request is not allowed.' }, { status: 403, headers: responseHeaders });
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return NextResponse.json({ message: 'Send sign-in details as JSON.' }, { status: 415, headers: responseHeaders });
  }
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('action' in body)
    || typeof body.action !== 'string' || !['login', 'register', 'google', 'link-google'].includes(body.action)) {
    return NextResponse.json({ message: 'Choose a sign-in method.' }, { status: 400, headers: responseHeaders });
  }
  const fields = body as Record<string, unknown>;
  const google = fields.action === 'google' || fields.action === 'link-google';
  try {
    const scope = scopeOf(request);
    let bearer: string | undefined;
    if (google) {
      if (scope !== 'customer') throw new SessionServiceError(403, 'Google sign-in is available for player accounts.');
      verifyGoogleChallenge(request, fields.tenantSlug, fields.nonce);
      if (fields.action === 'link-google') {
        const existing = await readSession('customer');
        if (!existing || existing.principal.tenantSlug !== fields.tenantSlug) throw new SessionServiceError(401, 'Sign in to your player account before connecting Google.');
        bearer = existing.session.token;
      }
    }
    const payload = google ? { tenantSlug: fields.tenantSlug, credential: fields.credential, nonce: fields.nonce } : {
      tenantSlug: fields.tenantSlug, email: fields.email, password: fields.password,
      ...(fields.action === 'register' ? { displayName: fields.displayName, ...(fields.phone === undefined ? {} : { phone: fields.phone }) } : {}),
    };
    const action = fields.action === 'link-google' ? 'google/link' : fields.action;
    const issued = await authRequest<{ accessToken: string }>('/auth/' + action, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) }, body: JSON.stringify(payload),
    });
    if (typeof issued.accessToken !== 'string') throw new SessionServiceError(503, 'The booking service returned an invalid session.');
    const auth = await validateSession(issued.accessToken);
    if (!auth) throw new SessionServiceError(401, 'Sign in to continue.');
    const response = NextResponse.json(auth, { headers: responseHeaders });
    response.cookies.set(cookieForScope(scope), issued.accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https',
      path: '/',
      expires: new Date(auth.principal.expiresAt),
    });
    return google ? clearGoogleChallenge(response, request) : response;
  } catch (error) {
    const response = failure(error);
    return google ? clearGoogleChallenge(response, request) : response;
  }
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ message: 'This sign-out request is not allowed.' }, { status: 403, headers: responseHeaders });
  try { return clearSession(NextResponse.json({ signedOut: true }, { headers: responseHeaders }), scopeOf(request)); }
  catch (error) { return failure(error); }
}
