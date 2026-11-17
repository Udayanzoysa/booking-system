import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import './globals.css';
import './calendar.css';
import './bookings.css';
import './operations.css';
import './invoices.css';

export const metadata: Metadata = {
  title: 'Techwing Arena | Indoor Cricket Bookings',
  description: 'Booking calendar and venue operations for indoor cricket.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
