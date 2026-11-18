import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import LoginForm from '../../components/LoginForm';
import { dashboardSections, hasDashboardAccess } from '../../lib/dashboard-access';
import { readSession } from '../../lib/server-auth';
import './login.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Staff sign in | Techwing Arena', robots: { index: false, follow: false } };

function safeDestination(value?: string): string {
  if (value === '/book' || value === '/dashboard') return value;
  if (value?.startsWith('/dashboard/')) {
    const section = value.slice('/dashboard/'.length);
    if (Object.prototype.hasOwnProperty.call(dashboardSections, section)) return value;
  }
  return '/dashboard';
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; unavailable?: string }> }) {
  const query = await searchParams;
  const destination = safeDestination(query.next);
  let session;
  try { session = await readSession(); } catch { /* Show the login form with a retryable service message. */ }
  if (session) redirect(hasDashboardAccess(session.principal.permissions) ? destination : '/book');
  return <LoginForm destination={destination} serviceUnavailable={query.unavailable === '1'}
    initialTenantSlug={process.env.CUSTOMER_TENANT_SLUG?.trim() || process.env.NEXT_PUBLIC_CUSTOMER_TENANT_SLUG?.trim() || 'strikzclub-homagama'} />;
}
