import { NextRequest, NextResponse } from 'next/server';
import { authRequest, readSession, sessionCookieName, SessionServiceError, validateSession } from '../../../lib/server-auth';

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

function clearSession(response: NextResponse) {
  response.cookies.set(sessionCookieName, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return response;
}

function failure(error: unknown) {
  const status = error instanceof SessionServiceError ? error.status : 503;
  const message = error instanceof SessionServiceError ? error.message : 'Could not complete sign-in.';
  return NextResponse.json({ message }, { status, headers: responseHeaders });
}

export async function GET() {
  try {
    const auth = await readSession();
    if (!auth) return clearSession(NextResponse.json({ message: 'Sign in to continue.' }, { status: 401, headers: responseHeaders }));
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
    || typeof body.action !== 'string' || !['login', 'register'].includes(body.action)) {
    return NextResponse.json({ message: 'Choose login or register.' }, { status: 400, headers: responseHeaders });
  }
  const fields = body as Record<string, unknown>;
  const payload = {
    tenantSlug: fields.tenantSlug,
    email: fields.email,
    password: fields.password,
    ...(fields.action === 'register' ? { displayName: fields.displayName, ...(fields.phone === undefined ? {} : { phone: fields.phone }) } : {}),
  };
  try {
    const issued = await authRequest<{ accessToken: string }>('/auth/' + fields.action, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (typeof issued.accessToken !== 'string') throw new SessionServiceError(503, 'The booking service returned an invalid session.');
    const auth = await validateSession(issued.accessToken);
    if (!auth) throw new SessionServiceError(401, 'Sign in to continue.');
    const response = NextResponse.json(auth, { headers: responseHeaders });
    response.cookies.set(sessionCookieName, issued.accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https',
      path: '/',
      expires: new Date(auth.principal.expiresAt),
    });
    return response;
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ message: 'This sign-out request is not allowed.' }, { status: 403, headers: responseHeaders });
  return clearSession(NextResponse.json({ signedOut: true }, { headers: responseHeaders }));
}
