import type { Metadata } from 'next';
import BookingApp from '../../components/BookingApp';
import { requireDashboardSession } from '../../lib/server-auth';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Techwing Arena | Staff workspace',
  robots: { index: false, follow: false },
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const auth = await requireDashboardSession();
  const query = await searchParams;
  return <BookingApp initialNow={Date.now()} initialSession={auth.session} initialPrincipal={auth.principal} initialSection="calendar" accessDenied={query.denied === '1'} />;
}
