import BookingApp from '../components/BookingApp';

export const dynamic = 'force-dynamic';

export default function Page() {
  return <BookingApp initialNow={Date.now()} />;
}
