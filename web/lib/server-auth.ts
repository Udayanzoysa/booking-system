import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Principal, Session } from './session';
import { canAccessSection, dashboardPath, hasDashboardAccess, type DashboardSection } from './dashboard-access';

export const sessionCookieName = 'techwing-session';
export type AuthSession = { session: Session; principal: Principal };

export class SessionServiceError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'SessionServiceError';
  }
}

function apiOrigin(): string {
  const configured = process.env.BOOKING_API_INTERNAL_ORIGIN?.trim()
    || process.env.NEXT_PUBLIC_BOOKING_API_ORIGIN?.trim()
    || 'http://localhost:3000';
  const parsed = new URL(configured);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new SessionServiceError(503, 'The booking service is not configured.');
  }
  return configured.replace(/\/+$/, '');
}

export async function authRequest<T>(path: string, options: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiOrigin() + '/api' + path, {
      ...options,
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new SessionServiceError(503, 'The booking service is unavailable. Try again shortly.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    let message = 'Could not complete sign-in.';
    if (body && typeof body === 'object' && 'message' in body) {
      const value = body.message;
      if (typeof value === 'string') message = value;
      else if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) message = value.join(' · ');
    }
    throw new SessionServiceError(response.status, message);
  }
  return body as T;
}

export async function validateSession(token: string): Promise<AuthSession | null> {
  let principal: Principal;
  try {
    principal = await authRequest<Principal>('/auth/me', { headers: { Authorization: 'Bearer ' + token } });
  } catch (error) {
    if (error instanceof SessionServiceError && error.status === 401) return null;
    throw error;
  }
  if (typeof principal?.userId !== 'string' || typeof principal.tenantId !== 'string'
    || !Array.isArray(principal.permissions) || !principal.permissions.every((entry) => typeof entry === 'string')
    || typeof principal.expiresAt !== 'number' || principal.expiresAt <= Date.now()
    || typeof principal.displayName !== 'string' || typeof principal.tenantSlug !== 'string') {
    return null;
  }
  return { session: { token, name: principal.displayName, tenantSlug: principal.tenantSlug }, principal };
}

export async function readSession(): Promise<AuthSession | null> {
  const cookie = (await cookies()).get(sessionCookieName)?.value;
  return cookie ? validateSession(cookie) : null;
}

export async function requireDashboardSession(section: DashboardSection = 'calendar'): Promise<AuthSession> {
  const target = dashboardPath(section);
  let auth: AuthSession | null;
  try {
    auth = await readSession();
  } catch {
    redirect('/login?next=' + encodeURIComponent(target) + '&unavailable=1');
  }
  if (!auth) redirect('/login?next=' + encodeURIComponent(target));
  if (!hasDashboardAccess(auth.principal.permissions)) redirect('/book');
  if (!canAccessSection(section, auth.principal.permissions)) redirect('/dashboard?denied=1');
  return auth;
}
