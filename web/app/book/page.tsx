import type { Metadata } from 'next';
import '@fontsource/barlow-condensed/800-italic.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource-variable/dm-sans';
import CustomerPortal from '../../components/club/CustomerPortal';
import '../customer.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Book a session | Strikz Club',
  description: 'Choose an available lane and manage your cricket bookings.',
  robots: { index: false, follow: false },
};

export default async function BookPage({ searchParams }: { searchParams: Promise<{ sport?: string }> }) {
  const { sport } = await searchParams;
  return <CustomerPortal initialSport={sport} initialNow={Date.now()} />;
}
