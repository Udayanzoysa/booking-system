import type { Metadata } from 'next';
import '@fontsource/barlow-condensed/800-italic.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource-variable/dm-sans';
import CustomerPortal from '../../components/club/CustomerPortal';
import '../customer.css';
import '../customer-booking-layout.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Book a session | Strikz Club',
  description: 'Book the Indoor Ground at Strikz Club and manage your sessions.',
  robots: { index: false, follow: false },
};

export default async function BookPage({ searchParams }: { searchParams: Promise<{ sport?: string }> }) {
  const { sport } = await searchParams;
  return <CustomerPortal initialSport={sport} initialNow={Date.now()}
    tenantSlug={process.env.CUSTOMER_TENANT_SLUG?.trim() || process.env.NEXT_PUBLIC_CUSTOMER_TENANT_SLUG?.trim() || ''}
    branchId={process.env.CUSTOMER_BRANCH_ID?.trim() || process.env.NEXT_PUBLIC_CUSTOMER_BRANCH_ID?.trim() || undefined}/>;
}
