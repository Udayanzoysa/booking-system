import { notFound } from 'next/navigation';
import BookingApp from '../../../components/BookingApp';
import { dashboardSections, type DashboardSection } from '../../../lib/dashboard-access';
import { requireDashboardSession } from '../../../lib/server-auth';

export const dynamic = 'force-dynamic';

export default async function DashboardSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (section === 'calendar' || !Object.prototype.hasOwnProperty.call(dashboardSections, section)) notFound();
  const selected = section as DashboardSection;
  const auth = await requireDashboardSession(selected);
  return <BookingApp initialNow={Date.now()} initialSession={auth.session} initialPrincipal={auth.principal} initialSection={selected} />;
}
