import type { Metadata } from 'next';
import BookingApp from '../../components/BookingApp';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Techwing Arena | Staff workspace',
  robots: { index: false, follow: false },
};

export default function DashboardPage() {
  return <BookingApp initialNow={Date.now()} />;
}
