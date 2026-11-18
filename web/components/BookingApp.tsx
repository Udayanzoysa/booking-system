'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import Workspace from './Workspace';
import type { Principal, Session } from '../lib/session';
import type { DashboardSection } from '../lib/dashboard-access';

type BookingAppProps = {
  initialNow: number;
  initialSession: Session;
  initialPrincipal: Principal;
  initialSection?: DashboardSection;
  accessDenied?: boolean;
};

export default function BookingApp({
  initialNow, initialSession, initialPrincipal, initialSection, accessDenied,
}: BookingAppProps) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 20_000 } },
  }));
  return <QueryClientProvider client={client}><Workspace initialNow={initialNow} initialSession={initialSession}
    initialPrincipal={initialPrincipal} initialSection={initialSection} accessDenied={accessDenied}/></QueryClientProvider>;
}
