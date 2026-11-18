'use client';

import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays, ChevronDown, ChevronRight, CircleHelp, ClipboardList, Clock3, CreditCard, DoorOpen,
  FileText, LayoutGrid, LogOut, Menu, Radio, Settings2, ShieldCheck, SlidersHorizontal, Users, X,
} from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { canAccessSection, dashboardPath, dashboardSections, hasDashboardAccess, type DashboardSection } from '../lib/dashboard-access';
import { io } from 'socket.io-client';
import { api, ApiError, apiOrigin, json } from '../lib/api';
import { branchMidnight, civilDay, shiftDay, weekStart } from '../lib/dates';
import Calendar, { type CalendarLane, type CalendarSlot } from './Calendar';
import { BookingDialog, type Booking, type BookingActions, type BookingDialogMode, type BookingOption } from './BookingDialog';
import { BookingList } from './BookingList';
import Operations from './Operations';
import Invoices, { InvoiceDialog } from './Invoices';
import BankTransferReviews from './BankTransferReviews';
import { PaymentSettings } from './PaymentSettings';
import type { Principal, Session } from '../lib/session';

const localTimeZone = 'Asia/Colombo';
const management = [
  { id: 'lanes', label: 'Arena & ground', icon: LayoutGrid, permissions: ['MANAGE_TENANT', 'MANAGE_LANES'] },
  { id: 'pricing', label: 'Pricing', icon: SlidersHorizontal, permissions: ['MANAGE_PRICING'] },
  { id: 'roster', label: 'Staff roster', icon: Clock3, permissions: ['MANAGE_ROSTER'] },
  { id: 'customers', label: 'Customers', icon: Users, permissions: ['MANAGE_CUSTOMERS', 'VIEW_CUSTOMER_PHONE'] },
  { id: 'policies', label: 'Cancellation policies', icon: Settings2, permissions: ['MANAGE_POLICIES'] },
  { id: 'access', label: 'Staff & roles', icon: ShieldCheck, permissions: ['MANAGE_USERS', 'MANAGE_RBAC'] },
] as const;
type Section = DashboardSection;
type Branch = { id: string; code?: string; name: string; timeZone: string; isActive?: boolean; webLeadOwnerId?: string };
type Grid = { branchId: string; timeZone: string; currency: string; lanes: CalendarLane[]; slots: CalendarSlot[] };
type BookingPage = { bookings: Booking[]; nextCursor: string | null };
type StaffRecord = { id: string; displayName: string };

const statusItems = new Set(['HELD', 'PAID', 'RESERVED']);
const activeStatuses = new Set(['HELD', 'CONFIRMED']);

type WorkspaceProps = {
  initialNow: number;
  initialSession: Session;
  initialPrincipal: Principal;
  initialSection?: DashboardSection;
  accessDenied?: boolean;
};

export default function Workspace({
  initialNow, initialSession: session, initialPrincipal, initialSection = 'calendar', accessDenied = false,
}: WorkspaceProps) {
  const cache = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const token = session.token;
  const section = initialSection;
  const [day, setDay] = useState('');
  const [branchId, setBranchId] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [selection, setSelection] = useState<BookingDialogMode | null>(null);
  const [bookingInvoice, setBookingInvoice] = useState<string | null>(null);
  const linkedBookingRequest = useRef<AbortController | null>(null);
  const [notice, setNotice] = useState('');
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(initialNow);

  const principal = useQuery({
    queryKey: ['session', token, 'me'],
    queryFn: () => api<Principal>('/auth/me', token),
    initialData: initialPrincipal,
    staleTime: 0,
    refetchInterval: 30_000,
  });
  const signedIn = !(principal.error instanceof ApiError && principal.error.status === 401);
  const permissions = principal.data.permissions;
  const staff = true;
  const canCreate = permissions.includes('MANAGE_BOOKINGS');
  const branchQuery = useQuery({ queryKey: ['session', token, 'branches'], queryFn: () => api<Branch[]>('/branches', token), enabled: signedIn });
  const branches = branchQuery.data ?? [];
  const visibleBranches = section === 'lanes' ? branches : branches.filter((item) => item.isActive !== false);
  const branch = visibleBranches.find((item) => item.id === branchId) ?? visibleBranches[0];
  const timezone = branch?.timeZone ?? localTimeZone;
  const today = civilDay(new Date(now), timezone);
  const selectedDay = day || today;
  const week = weekStart(selectedDay);
  const range = new URLSearchParams({ startsAt: branchMidnight(week, timezone), endsAt: branchMidnight(shiftDay(week, 7), timezone) });
  const gridQuery = useQuery({
    queryKey: ['session', token, 'availability', branch?.id, week, timezone],
    enabled: signedIn && Boolean(branch),
    queryFn: () => api<Grid>('/branches/' + branch?.id + '/availability?' + range, token),
    refetchInterval: connected ? false : 30_000,
  });
  const bookingQuery = useInfiniteQuery({
    queryKey: ['session', token, 'bookings'],
    enabled: signedIn,
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<BookingPage>('/bookings?limit=100' + (pageParam ? '&cursor=' + encodeURIComponent(pageParam) : ''), token),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const weekBookings = useQuery({
    queryKey: ['session', token, 'bookings', 'calendar', branch?.id, week, timezone],
    enabled: signedIn && Boolean(branch),
    queryFn: async ({ signal }) => {
      const records: Booking[] = [];
      const params = new URLSearchParams(range);
      params.set('branchId', branch!.id);
      params.set('limit', '100');
      let cursor: string | null = null;
      do {
        if (cursor) params.set('cursor', cursor);
        const page: BookingPage = await api('/bookings?' + params, token, { signal });
        records.push(...page.bookings);
        cursor = page.nextCursor;
      } while (cursor);
      return records;
    },
  });
  const customerQuery = useQuery({
    queryKey: ['session', token, 'customers'],
    enabled: signedIn && permissions.includes('MANAGE_CUSTOMERS'),
    queryFn: async () => {
      const rows: BookingOption[] = [];
      let cursor: string | null = null;
      do {
        const page: { customers: BookingOption[]; nextCursor: string | null } = await api('/customers' + (cursor ? '?after=' + encodeURIComponent(cursor) : ''), token);
        rows.push(...page.customers);
        cursor = page.nextCursor;
      } while (cursor && rows.length < 1000);
      return rows;
    },
  });
  const staffQuery = useQuery({
    queryKey: ['session', token, 'staff'],
    enabled: signedIn && permissions.includes('MANAGE_USERS'),
    queryFn: async () => {
      const rows: StaffRecord[] = [];
      let cursor: string | null = null;
      do {
        const page: { items: StaffRecord[]; nextCursor: string | null } = await api('/users?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), token);
        rows.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor && rows.length < 1000);
      return rows.map(({ id, displayName }) => ({ id, name: displayName }));
    },
  });
  const currency = gridQuery.data?.currency ?? 'LKR';
  const currentUser = { id: principal.data.userId, name: principal.data.displayName };
  const users = staffQuery.data ?? [];
  const leadOwners = users.length ? users : [currentUser];
  const customers = customerQuery.data ?? [];
  const rawSlots = gridQuery.data?.slots ?? [];
  const lanes = gridQuery.data?.lanes ?? [];
  const bookings = bookingQuery.data?.pages.flatMap((page) => page.bookings) ?? [];
  const calendarBookings = weekBookings.data ?? [];
  const bookingByExactSlot = new Map(calendarBookings.filter((item) => activeStatuses.has(item.status)
    && (item.status !== 'HELD' || (item.holdExpiresAt && Date.parse(item.holdExpiresAt) > now))).map((item) => [item.slotId, item]));
  const ownerLabel = (booking: Booking) => booking.label ?? booking.customerName ?? customers.find((person) => person.id === booking.customerId)?.name
    ?? (staff ? 'Booking ' + booking.id.slice(0, 8).toUpperCase() : 'Your booking');
  const slots = rawSlots.map((slot): CalendarSlot => {
    const booking = bookingByExactSlot.get(slot.id);
    return booking && statusItems.has(slot.status) ? { ...slot, booking: {
      id: booking.id, label: ownerLabel(booking), headcount: booking.headcount, amountPaid: booking.amountPaid,
      holdExpiresAt: booking.holdExpiresAt,
    } } : slot;
  });

  useEffect(() => {
    if (!token || !signedIn) return;
    const socket = io(apiOrigin + '/availability', { auth: { token }, reconnectionAttempts: 4 });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('availability.changed', () => {
      void cache.invalidateQueries({ queryKey: ['session', token, 'availability'] });
      void cache.invalidateQueries({ queryKey: ['session', token, 'bookings'] });
      void cache.invalidateQueries({ queryKey: ['session', token, 'bank-transfer-slips'] });
    });
    return () => { socket.removeAllListeners(); socket.disconnect(); setConnected(false); };
  }, [token, signedIn, cache]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const login = () => router.replace('/login?next=' + encodeURIComponent(pathname));
    if (principal.error instanceof ApiError && principal.error.status === 401) {
      login();
      return;
    }
    if (!hasDashboardAccess(permissions)) {
      router.replace('/book');
      return;
    }
    const timeout = setTimeout(login, Math.max(0, principal.data.expiresAt - Date.now()));
    return () => clearTimeout(timeout);
  }, [principal.error, principal.data.expiresAt, permissions, router, pathname]);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timeout);
  }, [notice]);

  function refresh() {
    void cache.invalidateQueries({ queryKey: ['session', token] });
  }

  async function signOut() {
    try {
      const response = await fetch('/api/session', { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not sign out. Try again.');
      linkedBookingRequest.current?.abort();
      cache.clear();
      router.replace('/login');
      router.refresh();
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : 'Could not sign out.');
    }
  }

  const actions: BookingActions = {
    async create(payload) {
      const booking = await api<Booking>('/bookings', token, json('POST', payload));
      refresh();
      return booking;
    },
    async cancel(id, payload) {
      const booking = await api<Booking>('/bookings/' + id + '/cancel', token, json('POST', payload));
      refresh();
      return booking;
    },
    async reschedule(id, payload) {
      const booking = await api<Booking>('/bookings/' + id + '/reschedule', token, json('POST', payload));
      refresh();
      return booking;
    },
    async payment(id, kind, payload) {
      const result = await api<{ booking: Booking }>('/payments/' + id + '/' + kind, token, json('POST', payload));
      refresh();
      return api<Booking>('/bookings/' + id, token).catch(() => result.booking);
    },
    async uploadSlip(id, payload, file) {
      const body = new FormData();
      body.set('attachment', file);
      body.set('amount', payload.amount);
      body.set('idempotencyKey', payload.idempotencyKey);
      body.set('reviewDecision', payload.reviewDecision);
      if (payload.reference) body.set('reference', payload.reference);
      const response = await fetch(apiOrigin + '/api/payments/' + id + '/bank-transfer-slips', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body });
      if (!response.ok) {
        const failure = await response.json().catch(() => null) as { message?: string | string[] } | null;
        throw new ApiError(response.status, [failure?.message ?? 'Could not save the transfer slip.'].flat().join(' · '));
      }
      refresh();
      return api<Booking>('/bookings/' + id, token);
    },
    ...(permissions.includes('MANAGE_CUSTOMERS') ? {
      async createCustomer(payload: {name: string; phone?: string}) {
        const customer = await api<BookingOption>('/customers', token, json('POST', payload));
        refresh();
        return customer;
      },
    } : {}),
  };

  function chooseSection(value: Section) {
    router.push(dashboardPath(value));
    setDrawer(false);
  }

  async function openLinkedBooking(id: string) {
    linkedBookingRequest.current?.abort();
    const controller = new AbortController();
    linkedBookingRequest.current = controller;
    try {
      const booking = await api<Booking>('/bookings/' + id, token, { signal: controller.signal });
      if (!controller.signal.aborted) setSelection({ kind: 'detail', booking });
    } catch (failure) {
      if (!controller.signal.aborted) {
        setNotice(failure instanceof Error ? failure.message : 'Could not open the linked booking.');
      }
    }
  }

  function selectSlot(slot: CalendarSlot) {
    if (slot.status === 'AVAILABLE' && canCreate) setSelection({ kind: 'new', slotId: slot.id });
    else if (slot.booking) {
      const booking = calendarBookings.find((item) => item.id === slot.booking?.id);
      if (booking) setSelection({ kind: 'detail', booking: { ...booking, label: ownerLabel(booking) } });
    } else if (statusItems.has(slot.status)) setNotice('This slot is reserved.');
  }

  function newBooking() {
    const slotId = slots.find((slot) => slot.status === 'AVAILABLE'
      && Date.parse(slot.startsAt) > Date.now()
      && civilDay(new Date(slot.startsAt), timezone) === selectedDay)?.id;
    setSelection({ kind: 'new', slotId });
  }

  const currentSection = management.find((item) => item.id === section);
  const canSeeInvoices = canAccessSection('invoices', permissions);
  const sectionLabel = dashboardSections[section].label;
  const canSeeSection = canAccessSection(section, permissions);
  useEffect(() => {
    if (signedIn && !canSeeSection && hasDashboardAccess(permissions)) {
      router.replace('/dashboard?denied=1');
      router.refresh();
    }
  }, [signedIn, canSeeSection, permissions, router]);
  const branchControl = visibleBranches.length ? <label className="branch-picker"><DoorOpen size={15}/><span className="sr-only">Branch</span><select value={branch?.id ?? ''} onChange={(event) => { setBranchId(event.target.value); setDay(''); }}>{visibleBranches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={13}/></label> : undefined;
  const signIn = () => router.push('/login');
  const displayError = principal.error ?? branchQuery.error ?? (section === 'calendar' ? gridQuery.error ?? weekBookings.error : section === 'bookings' ? bookingQuery.error : null);

  return <div className="shell">
    <button type="button" className={drawer ? 'nav-backdrop visible' : 'nav-backdrop'} onClick={() => setDrawer(false)} aria-label="Close navigation" tabIndex={drawer ? 0 : -1}/>
    <aside className={drawer ? 'shell-nav nav-visible' : 'shell-nav'}>
      <button type="button" className="brand" onClick={() => chooseSection('calendar')} aria-label="Techwing Arena calendar">
        <span className="brand-image"><Image src="/techwing.png" width={90} height={90} alt="" priority /></span>
        <span><strong>Techwing<span className="brand-period">.</span></strong><small>ARENA BOOKINGS</small></span>
      </button>
      <div className="nav-links">
        <p>WORKSPACE</p>
        <button type="button" className={section === 'calendar' ? 'active' : ''} onClick={() => chooseSection('calendar')}><CalendarDays size={17}/> Booking calendar</button>
        {canAccessSection('bookings', permissions) && <button type="button" className={section === 'bookings' ? 'active' : ''} onClick={() => chooseSection('bookings')}><ClipboardList size={17}/> All bookings</button>}
        {canSeeInvoices && <button type="button" className={section === 'invoices' ? 'active' : ''} onClick={() => chooseSection('invoices')}><FileText size={17}/> Invoices</button>}
        {(management.some((item) => item.permissions.some((permission) => permissions.includes(permission)))) && <p className="nav-divider">MANAGEMENT</p>}
        {management.filter((item) => item.permissions.some((permission) => permissions.includes(permission))).map(({ id, label, icon: Icon }) =>
          <button key={id} type="button" className={section === id ? 'active' : ''} onClick={() => chooseSection(id)}><Icon size={17}/>{label}</button>)}
        {permissions.includes('MANAGE_TENANT') && <button type="button" className={section === 'payments' ? 'active' : ''} onClick={() => chooseSection('payments')}><CreditCard size={17}/>Payment settings</button>}
      </div>
      <div className="nav-bottom">
        <div className="nav-connection"><Radio size={17}/><div><strong>{connected ? 'Live availability' : 'Arena workspace'}</strong><small>{branch?.name ?? 'Booking server'}</small></div></div>
        <button type="button" className="nav-profile" onClick={() => { void signOut(); }} aria-label="Sign out">
          <span className="profile-avatar">{currentUser.name.slice(0, 2).toUpperCase()}</span>
          <span><strong>{currentUser.name}</strong><small>Sign out</small></span>
          <LogOut size={15}/>
        </button>
      </div>
    </aside>
    <div className="shell-main">
      <header className="shell-top">
        <div className="crumbs"><button type="button" className="shell-icon mobile-menu" onClick={() => setDrawer(!drawer)} aria-label="Open navigation"><Menu size={20}/></button><span>Arena workspace</span><ChevronRight size={14}/><strong>{sectionLabel}</strong></div>
        <div className="top-actions">
          {branchControl}
          <span className="top-live"><i className={connected ? 'connected' : ''}/>{connected ? 'Live' : 'Polling'}</span>
        </div>
      </header>
      <main className="shell-content">
        {!signedIn || !canSeeSection ? <div className="workspace-empty" role="status">
          <ShieldCheck size={30}/><h1>Checking access…</h1>
        </div> : <>
        {accessDenied && <div className="workspace-error" role="alert">Your account does not have permission to open that page.</div>}
        {displayError && <div className="workspace-error" role="alert">{displayError.message}<button type="button" onClick={refresh}>Retry</button></div>}
        {section === 'calendar' && <>
          {signedIn && !branchQuery.isLoading && !branch && !branchQuery.error
            ? <div className="workspace-empty"><CalendarDays size={32}/><h1>No branches available</h1><p>Availability appears once this arena has an active branch and scheduled slots.</p>{permissions.includes('MANAGE_TENANT') && <button type="button" className="shell-primary" onClick={() => chooseSection('lanes')}>Set up a branch</button>}</div>
            : <Calendar date={selectedDay} today={today} onDateChange={setDay} timeZone={timezone} currency={currency}
                lanes={lanes} slots={slots} branchName={branch?.name} onSlotSelect={selectSlot}
                onNewBooking={newBooking} canBook={canCreate && Boolean(branch)}
                loading={branchQuery.isLoading || gridQuery.isLoading} />}
        </>}
        {section === 'bookings' && <>
          {permissions.includes('RECORD_PAYMENT') && <BankTransferReviews token={token} timezone={timezone} onChanged={refresh} onViewBooking={(id) => { void openLinkedBooking(id); }}/>}
          <BookingList bookings={bookings.filter((item) => !item.id.startsWith('released-'))}
          lanes={lanes} timezone={timezone} staff={staff} customers={customers} leadOwners={leadOwners}
          onSelect={(booking) => setSelection({ kind: 'detail', booking })}
          onCreate={canCreate && branch ? newBooking : undefined}
          nextPage={bookingQuery.hasNextPage ? () => { void bookingQuery.fetchNextPage(); } : undefined} loading={bookingQuery.isLoading || bookingQuery.isFetchingNextPage}/></>}
        {section === 'invoices' && <Invoices token={token} permissions={permissions} bookings={bookings}
          branches={branches} onConnect={signIn} onChanged={refresh}
          onViewBooking={!staff || permissions.includes('MANAGE_BOOKINGS') || permissions.includes('VIEW_BOOKINGS')
            ? (id) => { void openLinkedBooking(id); } : undefined}
          onMoreBookings={bookingQuery.hasNextPage ? () => { void bookingQuery.fetchNextPage(); } : undefined}/>}
        {currentSection && <Operations section={currentSection.id} token={token} branchId={branch?.id ?? ''} permissions={permissions}
          demo={false} onChange={refresh} onConnect={signIn}/>}
        {section === 'payments' && permissions.includes('MANAGE_TENANT') && <PaymentSettings token={token}/>}
        </>}
      </main>
    </div>
    {selection && <BookingDialog mode={selection} slots={slots} lanes={lanes} timezone={timezone} currency={currency}
      staff={staff} permissions={permissions} customers={customers} leadOwners={leadOwners}
      currentUser={currentUser} actions={actions} onClose={() => setSelection(null)}
      token={token} onViewInvoice={setBookingInvoice}
      />}
    {bookingInvoice && <InvoiceDialog invoiceId={bookingInvoice} token={token} permissions={permissions}
      onClose={() => setBookingInvoice(null)} onChanged={refresh}/>}
    {notice && <div className="workspace-toast" role="status"><CircleHelp size={17}/>{notice}<button type="button" aria-label="Dismiss" onClick={() => setNotice('')}><X size={15}/></button></div>}
  </div>;
}

