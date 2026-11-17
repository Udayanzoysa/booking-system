'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import Workspace from './Workspace';

export default function BookingApp({ initialNow }: { initialNow: number }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 20_000 } },
  }));
  return <QueryClientProvider client={client}><Workspace initialNow={initialNow} /></QueryClientProvider>;
}
