'use client';

import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight, CalendarDays, ChevronDown, ChevronRight, CircleHelp, ClipboardList, Clock3, DoorOpen,
  FileText, LayoutGrid, LogOut, Menu, Radio, Settings2, ShieldCheck, SlidersHorizontal, Users, X,
} from 'lucide-react';
import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, ApiError, apiOrigin, json } from '../lib/api';
import { branchMidnight, civilDay, shiftDay, weekStart } from '../lib/dates';
import { demoCustomers, demoLanes, demoPermissions, demoStaff, sampleBookings, sampleWeek } from '../lib/demo';
import Calendar, { type CalendarLane, type CalendarSlot } from './Calendar';
import { BookingDialog, type Booking, type BookingActions, type BookingDialogMode, type BookingOption } from './BookingDialog';
import { BookingList } from './BookingList';
import Operations from './Operations';
import Invoices, { InvoiceDialog } from './Invoices';
import SignIn, { type Principal, type Session } from './SignIn';

const localTimeZone = 'Asia/Colombo';
const quickDemo = process.env.NEXT_PUBLIC_TECHWING_QUICK_DEMO === '1';
const quickDemoKey = 'techwing-quick-demo-account';
const demoAccounts = { admin: 'Administrator', nimal: 'Nimal', kamal: 'Kamal' } as const;
type DemoAccount = keyof typeof demoAccounts;
const management = [
  { id: 'lanes', label: 'Branches & lanes', icon: LayoutGrid, permissions: ['MANAGE_TENANT', 'MANAGE_LANES'] },
  { id: 'pricing', label: 'Pricing', icon: SlidersHorizontal, permissions: ['MANAGE_PRICING'] },
  { id: 'roster', label: 'Staff roster', icon: Clock3, permissions: ['MANAGE_ROSTER'] },
  { id: 'customers', label: 'Customers', icon: Users, permissions: ['MANAGE_CUSTOMERS', 'VIEW_CUSTOMER_PHONE'] },
  { id: 'policies', label: 'Cancellation policies', icon: Settings2, permissions: ['MANAGE_POLICIES'] },
  { id: 'access', label: 'Staff & roles', icon: ShieldCheck, permissions: ['MANAGE_USERS', 'MANAGE_RBAC'] },
] as const;
type Section = 'calendar' | 'bookings' | 'invoices' | typeof management[number]['id'];
type Branch = { id: string; code?: string; name: string; timeZone: string; isActive?: boolean; webLeadOwnerId?: string };
type Grid = { branchId: string; timeZone: string; currency: string; lanes: CalendarLane[]; slots: CalendarSlot[] };
type BookingPage = { bookings: Booking[]; nextCursor: string | null };
type Customer = BookingOption & { walletBalance?: string };
type StaffRecord = { id: string; displayName: string };

const sampleBranch: Branch = { id: 'demo', name: 'Colombo Arena', timeZone: localTimeZone };
const statusItems = new Set(['HELD', 'PAID', 'RESERVED']);
const activeStatuses = new Set(['HELD', 'CONFIRMED']);

function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    if (quickDemo) return;
    try {
      const payload: Session | null = JSON.parse(sessionStorage.getItem('techwing-booking-session') ?? 'null');
      if (payload?.token) setSession(payload);
    } catch { sessionStorage.removeItem('techwing-booking-session'); }
  }, []);
  const save = (value: Session | null) => {
    if (value) sessionStorage.setItem('techwing-booking-session', JSON.stringify(value));
    else sessionStorage.removeItem('techwing-booking-session');
    setSession(value);
  };
  return [session, save] as const;
}

export default function Workspace({ initialNow }: { initialNow: number }) {
  const cache = useQueryClient();
  const [manualSession, saveSession] = useSession();
  const [demoAccount, setDemoAccount] = useState<DemoAccount | null>(null);
  const renewedDemoAccount = useRef<DemoAccount | null>(null);
  useEffect(() => {
    if (!quickDemo) return;
    let account: DemoAccount = 'admin';
    try {
      const remembered = localStorage.getItem(quickDemoKey);
      if (remembered === 'nimal' || remembered === 'kamal') account = remembered;
    } catch { /* The switcher still works when storage is disabled. */ }
    setDemoAccount(account);
  }, []);
  const demoSessionQuery = useQuery({
    queryKey: ['quick-demo-session', demoAccount],
    queryFn: ({ signal }) => api<{ accessToken: string; displayName: string }>('/auth/demo', null, {
      ...json('POST', { account: demoAccount }), signal,
    }),
    enabled: quickDemo && demoAccount !== null,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const session = quickDemo ? demoSessionQuery.data && {
    token: demoSessionQuery.data.accessToken, name: demoSessionQuery.data.displayName,
  } : manualSession;
  const token = session?.token ?? null;
  const demo = !quickDemo && !token;
  const [section, setSection] = useState<Section>('calendar');
  const [day, setDay] = useState('');
  const [branchId, setBranchId] = useState('');
  const [showSignIn, setShowSignIn] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [selection, setSelection] = useState<BookingDialogMode | null>(null);
  const [bookingInvoice, setBookingInvoice] = useState<string | null>(null);
  const linkedBookingRequest = useRef<AbortController | null>(null);
  const [notice, setNotice] = useState('');
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(initialNow);
  const [sampleChanges, setSampleChanges] = useState<Booking[]>([]);
  const [samplePeople, setSamplePeople] = useState(demoCustomers);

  const principal = useQuery({ queryKey: ['session', token, 'me'], queryFn: () => api<Principal>('/auth/me', token), enabled: Boolean(token) });
  const signedIn = Boolean(principal.data) && !(quickDemo && principal.error instanceof ApiError && principal.error.status === 401);
  const permissions = demo ? demoPermissions : principal.data?.permissions ?? [];
  const staff = demo || permissions.some((permission) => permission !== 'CREATE_UNPAID_HOLD');
  const canCreate = !staff || permissions.includes('MANAGE_BOOKINGS');
  const branchQuery = useQuery({ queryKey: ['session', token, 'branches'], queryFn: () => api<Branch[]>('/branches', token), enabled: signedIn });
  const branches = demo ? [sampleBranch] : branchQuery.data ?? [];
  const visibleBranches = section === 'lanes' ? branches : branches.filter((item) => item.isActive !== false);
  const branch = visibleBranches.find((item) => item.id === branchId)
    ?? (quickDemo ? visibleBranches.find((item) => item.code === 'sample-volume') : undefined)
    ?? visibleBranches[0];
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
  const profile = useQuery({ queryKey: ['session', token, 'profile'], enabled: signedIn && !staff, queryFn: () => api<Customer>('/customers/me', token) });
  const currency = demo ? 'LKR' : gridQuery.data?.currency ?? 'LKR';
  const users = demo ? demoStaff : staffQuery.data ?? [];
  const currentUser = demo ? demoStaff[0] : principal.data
    ? { id: principal.data.userId, name: profile.data?.name ?? users.find((person) => person.id === principal.data?.userId)?.name ?? session?.name ?? 'Staff' }
    : undefined;
  const leadOwners = users.length ? users : currentUser ? [currentUser] : [];
  const customers = demo ? samplePeople : customerQuery.data ?? [];
  const rawDemoSlots = useMemo(() => demo ? sampleWeek(week, []) : [], [demo, week]);
  const sampleRecords = useMemo(() => sampleBookings(rawDemoSlots, initialNow), [rawDemoSlots, initialNow]);
  const rawSlots = demo ? sampleWeek(week, sampleChanges) : gridQuery.data?.slots ?? [];
  const lanes = demo ? demoLanes : gridQuery.data?.lanes ?? [];
  const bookings = demo
    ? [...sampleChanges, ...sampleRecords.filter((item) => !sampleChanges.some((changed) => changed.id === item.id))]
    : bookingQuery.data?.pages.flatMap((page) => page.bookings) ?? [];
  const calendarBookings = demo ? bookings : weekBookings.data ?? [];
  const bookingByExactSlot = new Map(calendarBookings.filter((item) => activeStatuses.has(item.status)
    && (demo || item.status !== 'HELD' || (item.holdExpiresAt && Date.parse(item.holdExpiresAt) > now))).map((item) => [item.slotId, item]));
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
    });
    return () => { socket.removeAllListeners(); socket.disconnect(); setConnected(false); };
  }, [token, signedIn, cache]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const renewDemoSession = demoSessionQuery.refetch;
  const demoExpiry = principal.data?.expiresAt;
  useEffect(() => {
    if (!quickDemo || !demoExpiry) return;
    const timeout = setTimeout(() => { void renewDemoSession(); }, Math.max(0, demoExpiry - Date.now() - 30_000));
    return () => clearTimeout(timeout);
  }, [demoExpiry, renewDemoSession]);

  useEffect(() => {
    if (!(principal.error instanceof ApiError) || principal.error.status !== 401) return;
    if (!quickDemo) {
      setShowSignIn(true);
    } else if (demoAccount && demoAccount !== renewedDemoAccount.current) {
      renewedDemoAccount.current = demoAccount;
      void renewDemoSession();
    }
  }, [demoAccount, principal.error, renewDemoSession]);

  useEffect(() => {
    if (signedIn && !principal.error) renewedDemoAccount.current = null;
  }, [signedIn, principal.error]);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timeout);
  }, [notice]);

  function refresh() {
    void cache.invalidateQueries({ queryKey: ['session', token] });
  }

  function switchSession(next: Session | null) {
    linkedBookingRequest.current?.abort();
    if (token) cache.removeQueries({ queryKey: ['session', token] });
    saveSession(next);
    setShowSignIn(false);
    setBranchId('');
    setDay('');
    setSection('calendar');
    setSelection(null);
    setBookingInvoice(null);
  }

  function switchDemoAccount(next: DemoAccount) {
    if (next === demoAccount) return;
    if (token) cache.removeQueries({ queryKey: ['session', token] });
    setSelection(null);
    linkedBookingRequest.current?.abort();
    setBookingInvoice(null);
    setNotice('');
    renewedDemoAccount.current = null;
    setDemoAccount(next);
    try { localStorage.setItem(quickDemoKey, next); } catch { /* The active account still switches. */ }
  }

  function updateSample(booking: Booking): Booking {
    setSampleChanges((records) => [booking, ...records.filter((existing) => existing.id !== booking.id)]);
    return booking;
  }

  const actions: BookingActions = {
    async create(payload) {
      if (!demo) {
        const booking = await api<Booking>('/bookings', token, json('POST', payload));
        refresh();
        return booking;
      }
      const slot = slots.find((entry) => entry.id === payload.slotId);
      if (!slot || slot.status !== 'AVAILABLE') throw new Error('Choose an available slot.');
      const paid = payload.initialPayment?.amount ?? '0';
      const total = slot.price ?? '0';
      const paymentStatus = +paid >= +total ? 'FULLY_PAID' : +paid > 0 ? 'DEPOSIT_PAID' : 'UNPAID';
      return updateSample({
        id: crypto.randomUUID(), slotId: slot.id, slot, customerId: payload.customerId ?? '',
        leadOwnerId: payload.leadOwnerId ?? demoStaff[0].id, creatorId: demoStaff[0].id,
        headcount: payload.headcount, leadSource: payload.leadSource ?? 'WEB', currency, totalAmount: total, amountPaid: paid,
        balanceDue: String(Math.max(0, +total - +paid)), refundableAmount: '0',
        status: paymentStatus === 'UNPAID' ? 'HELD' : 'CONFIRMED', paymentStatus,
        holdExpiresAt: paymentStatus === 'UNPAID' ? new Date(Date.now() + 15 * 60000).toISOString() : null,
        unstaffed: !slot.staffed,
      });
    },
    async cancel(id, payload) {
      if (!demo) {
        const booking = await api<Booking>('/bookings/' + id + '/cancel', token, json('POST', payload));
        refresh();
        return booking;
      }
      const previous = bookings.find((entry) => entry.id === id);
      if (!previous) throw new Error('Booking unavailable.');
      return updateSample({ ...previous, status: 'CANCELLED', holdExpiresAt: null, balanceDue: '0', refundableAmount: previous.amountPaid });
    },
    async reschedule(id, payload) {
      if (!demo) {
        const booking = await api<Booking>('/bookings/' + id + '/reschedule', token, json('POST', payload));
        refresh();
        return booking;
      }
      const previous = bookings.find((entry) => entry.id === id);
      const slot = slots.find((entry) => entry.id === payload.slotId && entry.status === 'AVAILABLE');
      if (!previous || !slot) throw new Error('Choose an available destination.');
      const total = slot.price ?? '0';
      const paid = Number(previous.amountPaid);
      // Release the old sample slot, including a reservation in the initial schedule.
      setSampleChanges((records) => [
        { ...previous, id: 'released-' + previous.id + '-' + previous.slotId, status: 'CANCELLED' },
        ...records,
      ]);
      return updateSample({
        ...previous, slotId: slot.id, slot, totalAmount: total, unstaffed: !slot.staffed,
        balanceDue: String(Math.max(0, +total - paid)), refundableAmount: String(Math.max(0, paid - +total)),
        paymentStatus: paid >= +total ? 'FULLY_PAID' : paid > 0 ? 'DEPOSIT_PAID' : 'UNPAID',
      });
    },
    async payment(id, kind, payload) {
      if (!demo) {
        const result = await api<{ booking: Booking }>('/payments/' + id + '/' + kind, token, json('POST', payload));
        refresh();
        return api<Booking>('/bookings/' + id, token).catch(() => result.booking);
      }
      const previous = bookings.find((entry) => entry.id === id);
      if (!previous) throw new Error('Booking unavailable.');
      const paid = +previous.amountPaid + (kind === 'refunds' ? -Number(payload.amount) : Number(payload.amount));
      if (paid < 0 || (kind !== 'refunds' && paid > +previous.totalAmount)) throw new Error('Amount is outside the payable balance.');
      return updateSample({
        ...previous, amountPaid: String(paid), status: kind === 'refunds' ? previous.status : 'CONFIRMED',
        paymentStatus: paid >= +previous.totalAmount ? 'FULLY_PAID' : paid > 0 ? 'DEPOSIT_PAID' : 'UNPAID',
        balanceDue: String(Math.max(0, +previous.totalAmount - paid)), holdExpiresAt: null,
        refundableAmount: previous.status === 'CANCELLED' ? String(paid) : String(Math.max(0, paid - +previous.totalAmount)),
      });
    },
    ...(demo || permissions.includes('MANAGE_CUSTOMERS') ? {
      async createCustomer(payload) {
        if (!demo) {
          const customer = await api<BookingOption>('/customers', token, json('POST', payload));
          refresh();
          return customer;
        }
        const customer = { id: crypto.randomUUID(), ...payload };
        setSamplePeople((people) => [customer, ...people]);
        return customer;
      },
    } : {}),
  };

  function chooseSection(value: Section) {
    setSection(value);
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
      && (demo || Date.parse(slot.startsAt) > Date.now())
      && civilDay(new Date(slot.startsAt), timezone) === selectedDay)?.id;
    setSelection({ kind: 'new', slotId });
  }

  const currentSection = management.find((item) => item.id === section);
  const canSeeInvoices = !quickDemo || permissions.includes('MANAGE_INVOICES');
  const canSeeSection = (!currentSection || currentSection.permissions.some((permission) => permissions.includes(permission)))
    && (section !== 'invoices' || canSeeInvoices);
  useEffect(() => {
    if (quickDemo && signedIn && !canSeeSection) setSection('bookings');
  }, [signedIn, canSeeSection]);
  const sectionLabel = section === 'calendar' ? 'Booking calendar' : section === 'bookings' ? staff ? 'All bookings' : 'My bookings' : section === 'invoices' ? 'Invoices' : currentSection?.label;
  const branchControl = visibleBranches.length ? <label className="branch-picker"><DoorOpen size={15}/><span className="sr-only">Branch</span><select value={branch?.id ?? ''} onChange={(event) => { setBranchId(event.target.value); setDay(''); }}>{visibleBranches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={13}/></label> : undefined;
  const signIn = () => setShowSignIn(true);
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
        <button type="button" className={section === 'bookings' ? 'active' : ''} onClick={() => chooseSection('bookings')}><ClipboardList size={17}/> {staff ? 'All bookings' : 'My bookings'}</button>
        {canSeeInvoices && <button type="button" className={section === 'invoices' ? 'active' : ''} onClick={() => chooseSection('invoices')}><FileText size={17}/> Invoices</button>}
        {(demo || management.some((item) => item.permissions.some((permission) => permissions.includes(permission)))) && <p className="nav-divider">MANAGEMENT</p>}
        {management.filter((item) => demo || item.permissions.some((permission) => permissions.includes(permission))).map(({ id, label, icon: Icon }) =>
          <button key={id} type="button" className={section === id ? 'active' : ''} onClick={() => chooseSection(id)}><Icon size={17}/>{label}</button>)}
      </div>
      <div className="nav-bottom">
        <div className="nav-connection"><Radio size={17}/><div><strong>{demo || quickDemo ? 'Demo workspace' : connected ? 'Live availability' : 'API workspace'}</strong><small>{demo ? 'Sample venue and bookings' : branch?.name ?? 'Booking server'}</small></div></div>
        {quickDemo ? <div className="nav-profile">
          <span className="profile-avatar">{demoAccount === 'admin' ? 'AD' : demoAccount === 'nimal' ? 'NI' : demoAccount === 'kamal' ? 'KA' : '–'}</span>
          <span><strong>{demoAccount ? demoAccounts[demoAccount] : 'Demo account'}</strong><small>{demoAccount === 'admin' ? 'Admin access' : 'Staff access'}</small></span>
        </div> : <button type="button" className="nav-profile" onClick={() => demo ? signIn() : switchSession(null)} aria-label={demo ? 'Connect to your arena' : 'Sign out'}>
          <span className="profile-avatar">{demo ? 'SA' : (currentUser?.name ?? session?.name ?? '?').slice(0, 2).toUpperCase()}</span>
          <span><strong>{demo ? 'Staff Admin' : currentUser?.name ?? session?.name}</strong><small>{demo ? 'Connect your arena' : staff ? 'Venue staff' : 'Player account'}</small></span>
          {demo ? <ChevronRight size={15}/> : <LogOut size={15}/>}
        </button>}
      </div>
    </aside>
    <div className="shell-main">
      <header className="shell-top">
        <div className="crumbs"><button type="button" className="shell-icon mobile-menu" onClick={() => setDrawer(!drawer)} aria-label="Open navigation"><Menu size={20}/></button><span>Arena workspace</span><ChevronRight size={14}/><strong>{sectionLabel}</strong></div>
        <div className="top-actions">
          {branchControl}
          {quickDemo ? <label className="demo-account-picker"><Users size={15}/><span className="demo-account-label">Demo account</span><select aria-label="Switch demo account" value={demoAccount ?? 'admin'} disabled={demoAccount === null} onChange={(event) => switchDemoAccount(event.target.value as DemoAccount)}>
            <option value="admin">Administrator</option><option value="nimal">Nimal · Staff</option><option value="kamal">Kamal · Staff</option>
          </select><ChevronDown size={13}/></label> : demo ? <button type="button" className="connect-btn" onClick={signIn}>Connect arena <ArrowRight size={14}/></button> :
            <span className="top-live"><i className={connected ? 'connected' : ''}/>{connected ? 'Live' : 'Polling'}</span>}
        </div>
      </header>
      <main className="shell-content">
        {quickDemo && (!signedIn || !canSeeSection) ? <div className="workspace-empty" role="status">
          <Users size={30}/><h1>{demoSessionQuery.error || principal.error ? 'Demo sign-in unavailable' : 'Opening demo workspace'}</h1>
          {(demoSessionQuery.error || principal.error) && <><p>{(demoSessionQuery.error ?? principal.error)?.message}</p><button className="shell-primary" type="button" onClick={() => { void renewDemoSession(); }}>Retry</button></>}
        </div> : <>
        {displayError && <div className="workspace-error" role="alert">{displayError.message}<button type="button" onClick={refresh}>Retry</button></div>}
        {section === 'calendar' && <>
          {!demo && signedIn && !branchQuery.isLoading && !branch && !branchQuery.error
            ? <div className="workspace-empty"><CalendarDays size={32}/><h1>No branches available</h1><p>Availability appears once this arena has an active branch and scheduled slots.</p>{permissions.includes('MANAGE_TENANT') && <button type="button" className="shell-primary" onClick={() => chooseSection('lanes')}>Set up a branch</button>}</div>
            : <Calendar date={selectedDay} today={today} onDateChange={setDay} timeZone={timezone} currency={currency}
                lanes={lanes} slots={slots} branchName={branch?.name} onSlotSelect={selectSlot}
                onNewBooking={newBooking} canBook={canCreate && Boolean(branch)}
                loading={!demo && (principal.isPending || branchQuery.isLoading || gridQuery.isLoading)} />}
        </>}
        {section === 'bookings' && <BookingList bookings={bookings.filter((item) => !item.id.startsWith('released-'))}
          lanes={lanes} timezone={timezone} staff={staff} customers={customers} leadOwners={leadOwners}
          onSelect={(booking) => setSelection({ kind: 'detail', booking })}
          onCreate={canCreate && branch ? newBooking : undefined}
          nextPage={bookingQuery.hasNextPage ? () => { void bookingQuery.fetchNextPage(); } : undefined} loading={bookingQuery.isLoading || bookingQuery.isFetchingNextPage}/>}
        {section === 'invoices' && <Invoices token={token} permissions={permissions} bookings={bookings}
          branches={branches} onConnect={signIn} onChanged={refresh}
          onViewBooking={!staff || permissions.includes('MANAGE_BOOKINGS') || permissions.includes('VIEW_BOOKINGS')
            ? (id) => { void openLinkedBooking(id); } : undefined}
          onMoreBookings={bookingQuery.hasNextPage ? () => { void bookingQuery.fetchNextPage(); } : undefined}/>}
        {currentSection && <Operations section={currentSection.id} token={token} branchId={branch?.id ?? ''} permissions={permissions}
          demo={demo} onChange={refresh} onConnect={signIn}/>}
        </>}
      </main>
    </div>
    {selection && <BookingDialog mode={selection} slots={slots} lanes={lanes} timezone={timezone} currency={currency}
      staff={staff} demo={demo} permissions={permissions} customers={customers} leadOwners={leadOwners}
      currentUser={currentUser} walletBalance={profile.data?.walletBalance} actions={actions} onClose={() => setSelection(null)}
      token={token} onViewInvoice={setBookingInvoice}
      />}
    {bookingInvoice && <InvoiceDialog invoiceId={bookingInvoice} token={token} permissions={permissions}
      onClose={() => setBookingInvoice(null)} onChanged={refresh}/>}
    {!quickDemo && showSignIn && <SignIn onClose={() => setShowSignIn(false)} onSuccess={switchSession}/>}
    {notice && <div className="workspace-toast" role="status"><CircleHelp size={17}/>{notice}<button type="button" aria-label="Dismiss" onClick={() => setNotice('')}><X size={15}/></button></div>}
  </div>;
}

