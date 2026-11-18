'use client';

import { QueryClient, QueryClientProvider, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3,
  LogOut, MapPin, Phone, RefreshCw, Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { io } from 'socket.io-client';
import { api, ApiError, apiOrigin, json } from '../../lib/api';
import { branchMidnight, civilDay, shiftDay } from '../../lib/dates';
import { BookingDialog, bookingState, formatBookingMoney, type Booking, type BookingActions, type BookingDialogMode } from '../BookingDialog';
import type { CalendarLane, CalendarSlot } from '../Calendar';
import { InvoiceDialog } from '../Invoices';

type PortalProps = { initialSport?: string; initialNow?: number };
type Session = { token: string; tenantSlug: string };
type Principal = { userId: string; tenantId: string; permissions: string[]; expiresAt: number };
type Customer = { id: string; name: string; walletBalance: string; userId: string };
type Branch = { id: string; code: string; name: string; timeZone: string; isActive: boolean };
type Availability = { branchId: string; timeZone: string; currency: string; lanes: CalendarLane[]; slots: CalendarSlot[] };
type BookingPage = { bookings: Booking[]; nextCursor: string | null };

const demo = process.env.NEXT_PUBLIC_TECHWING_QUICK_DEMO === '1';
const customerTenant = process.env.NEXT_PUBLIC_CUSTOMER_TENANT_SLUG?.trim() || (demo ? 'techwing-auth-sample' : '');
const customerBranch = process.env.NEXT_PUBLIC_CUSTOMER_BRANCH_ID?.trim();
const sessionKey = 'strikz-customer-session:' + customerTenant;
const timeFormat = (value: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const dateFormat = (value: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'medium' }).format(new Date(value));

export default function CustomerPortal({ initialSport = 'cricket', initialNow = Date.now() }: PortalProps) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 15_000 } },
  }));
  return <QueryClientProvider client={client}><CustomerWorkspace sport={initialSport} initialNow={initialNow} /></QueryClientProvider>;
}

function CustomerWorkspace({ sport, initialNow }: { sport: string; initialNow: number }) {
  const cache = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [signUp, setSignUp] = useState(false);
  const [authPending, setAuthPending] = useState(false);
  const [authError, setAuthError] = useState('');
  const [actionError, setActionError] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [date, setDate] = useState('');
  const [laneType, setLaneType] = useState('ALL');
  const [tab, setTab] = useState<'slots' | 'bookings'>('slots');
  const [selection, setSelection] = useState<BookingDialogMode | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [now, setNow] = useState(initialNow);
  const token = session?.token ?? null;
  const futsal = sport.toLowerCase() === 'futsal' || sport.toLowerCase() === 'football';

  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(sessionKey) ?? 'null');
      if (stored && typeof stored === 'object' && 'token' in stored && typeof stored.token === 'string'
        && 'tenantSlug' in stored && stored.tenantSlug === customerTenant) setSession(stored as Session);
    } catch { sessionStorage.removeItem(sessionKey); }
    setSessionReady(true);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const principal = useQuery({
    queryKey: ['customer', token, 'principal'],
    queryFn: ({ signal }) => api<Principal>('/auth/me', token, { signal }),
    enabled: Boolean(token),
  });
  const profile = useQuery({
    queryKey: ['customer', token, 'profile'],
    queryFn: ({ signal }) => api<Customer>('/customers/me', token, { signal }),
    enabled: Boolean(principal.data),
  });
  const signedIn = Boolean(token && principal.data && profile.data);
  const branchQuery = useQuery({
    queryKey: ['customer', token, 'branches'],
    queryFn: ({ signal }) => api<Branch[]>('/branches', token, { signal }),
    enabled: signedIn,
  });
  const branches = (branchQuery.data ?? []).filter((branch) => branch.isActive !== false && (!customerBranch || branch.id === customerBranch));
  const branch = branches.find((item) => item.id === selectedBranch)
    ?? (demo ? branches.find((item) => item.code === 'sample-volume') : undefined) ?? branches[0];
  const timeZone = branch?.timeZone ?? 'Asia/Colombo';
  const today = civilDay(new Date(now), timeZone);
  const selectedDate = date || today;
  const query = new URLSearchParams({
    startsAt: branchMidnight(selectedDate, timeZone),
    endsAt: branchMidnight(shiftDay(selectedDate, 7), timeZone),
  });
  const availability = useQuery({
    queryKey: ['customer', token, 'availability', branch?.id, selectedDate, timeZone],
    queryFn: ({ signal }) => api<Availability>('/branches/' + branch!.id + '/availability?' + query, token, { signal }),
    enabled: signedIn && Boolean(branch) && !futsal,
    refetchInterval: 30_000,
  });
  const reservations = useInfiniteQuery({
    queryKey: ['customer', token, 'bookings'],
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) => api<BookingPage>('/bookings?limit=30' + (pageParam ? '&cursor=' + encodeURIComponent(pageParam) : ''), token, { signal }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: signedIn,
  });
  const lanes = availability.data?.lanes ?? [];
  const dialogSlots = (availability.data?.slots ?? []).filter((slot) => Date.parse(slot.startsAt) > now);
  const slots = dialogSlots.filter((slot) => civilDay(new Date(slot.startsAt), timeZone) === selectedDate);
  const currency = availability.data?.currency ?? 'LKR';
  const permissions = principal.data?.permissions ?? [];
  const bookings = reservations.data?.pages.flatMap((page) => page.bookings)
    .filter((booking) => booking.customerId === profile.data?.id) ?? [];
  const hasProfileError = profile.error instanceof ApiError && profile.error.status === 404;
  const expired = principal.error instanceof ApiError && principal.error.status === 401;

  function clearSession(message = '') {
    setSession(null);
    sessionStorage.removeItem(sessionKey);
    setSelection(null);
    setInvoiceId(null);
    setAuthError(message);
    setActionError('');
    setTab('slots');
    cache.clear();
  }

  useEffect(() => {
    if (expired) clearSession('Your session has expired. Sign in to continue.');
  }, [expired]);
  useEffect(() => {
    if (hasProfileError) clearSession('Use a player account to book here. Venue staff can open the staff dashboard.');
  }, [hasProfileError]);
  useEffect(() => {
    if (!signedIn || !token) return;
    const socket = io(apiOrigin + '/availability', { auth: { token }, reconnectionAttempts: 3 });
    socket.on('availability.changed', () => {
      void cache.invalidateQueries({ queryKey: ['customer', token, 'availability'] });
      void cache.invalidateQueries({ queryKey: ['customer', token, 'bookings'] });
    });
    return () => { socket.removeAllListeners(); socket.disconnect(); };
  }, [signedIn, token, cache]);

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthPending(true);
    setAuthError('');
    const fields = new FormData(event.currentTarget);
    const body = {
      tenantSlug: customerTenant, email: String(fields.get('email')).trim(),
      password: String(fields.get('password')),
      ...(signUp ? {
        displayName: String(fields.get('displayName')).trim(),
        ...(fields.get('phone') ? { phone: String(fields.get('phone')).trim() } : {}),
      } : {}),
    };
    try {
      const result = await api<{ accessToken: string }>(signUp ? '/auth/register' : '/auth/login', null, json('POST', body));
      await api<Customer>('/customers/me', result.accessToken);
      const next = { token: result.accessToken, tenantSlug: customerTenant };
      sessionStorage.setItem(sessionKey, JSON.stringify(next));
      setSession(next);
    } catch (error) {
      setAuthError(error instanceof ApiError && error.status === 404
        ? 'This account has no player profile. Register a player account or contact the club.'
        : error instanceof Error ? error.message : 'Could not sign in.');
    } finally { setAuthPending(false); }
  }

  function refresh() {
    void cache.invalidateQueries({ queryKey: ['customer', token] });
  }
  async function saveBooking(path: string, body: unknown) {
    const result = await api<Booking>(path, token, json('POST', body));
    refresh();
    return result;
  }
  const actions: BookingActions = {
    create: (payload) => saveBooking('/bookings', payload),
    cancel: (id, payload) => saveBooking('/bookings/' + id + '/cancel', payload),
    reschedule: (id, payload) => saveBooking('/bookings/' + id + '/reschedule', payload),
    async payment(id, kind, payload) {
      if (kind !== 'wallet-collections') throw new Error('Choose wallet payment for this booking.');
      await api('/payments/' + id + '/wallet-collections', token, json('POST', payload));
      refresh();
      return api<Booking>('/bookings/' + id, token);
    },
  };
  async function openBooking(id: string) {
    setActionError('');
    try { setSelection({ kind: 'detail', booking: await api<Booking>('/bookings/' + id, token) }); }
    catch (error) { setActionError(error instanceof Error ? error.message : 'Could not open your booking.'); }
  }
  const dataError = branchQuery.error ?? availability.error ?? reservations.error;
  const pageLoading = Boolean(token && !signedIn && !expired && !hasProfileError);

  return <div className="customer-portal">
    <header className="cp-header">
      <Link href="/" className="cp-wordmark" aria-label="Strikz Club home"><i aria-hidden="true"><b/><b/><b/></i>STRIKZ <span>CLUB</span></Link>
      <nav aria-label="Booking navigation"><Link href="/"><ArrowLeft size={15}/> Back to club</Link>
        {signedIn && <button type="button" onClick={() => clearSession()}><LogOut size={15}/> Sign out</button>}
      </nav>
    </header>
    <main className="cp-main">
      <div className="cp-heading"><p className="cp-eyebrow">STRIKZ CLUB · PLAYER BOOKINGS</p>
        <h1>{futsal ? <>LET’S PLAY <em>FUTSAL.</em></> : <>YOUR NEXT <em>SESSION.</em></>}</h1>
        <p>{futsal ? 'Speak with the club to arrange your futsal session.' : signedIn ? 'Choose a lane and available session, or manage your upcoming bookings.' : 'Sign in or create a player account to see live availability and reserve your session.'}</p>
      </div>
      {futsal ? <section className="cp-contact-card">
        <img src="/strikz/images/futsal.webp" width={640} height={420} alt="Indoor futsal at Strikz Club"/>
        <div><p className="cp-eyebrow">FUTSAL BOOKINGS</p><h2>BRING YOUR <em>TEAM.</em></h2><p>Call the club to check court availability, session length, and pricing.</p>
          <a href="tel:+94701261966" className="cp-primary"><Phone size={17}/> 070 126 1966</a>
          <Link href="/book?sport=cricket" className="cp-text-link">Book a cricket session <ArrowRight size={15}/></Link></div>
      </section> : !customerTenant ? <section className="cp-state-card"><Phone size={25}/><h2>Arrange your session with the club</h2><p>Call to check available times and prices.</p><a href="tel:+94701261966" className="cp-primary">070 126 1966</a></section> :
      !sessionReady || pageLoading ? <section className="cp-state-card" role="status"><Clock3 size={24}/><p>Opening your player account…</p></section> :
      !signedIn ? <div className="cp-auth-layout">
        <div className="cp-auth-image"><img src="/strikz/images/cricket.webp" width={640} height={420} alt="Indoor cricket under the lights"/><div><p>YOUR GAME. YOUR TIME.</p><span>Live slots · Clear prices · Your bookings</span></div></div>
        <section className="cp-auth-card" aria-labelledby="customer-auth-title">
          <div className="cp-auth-tabs"><button type="button" className={!signUp ? 'active' : ''} onClick={() => { setSignUp(false); setAuthError(''); }}>Sign in</button><button type="button" className={signUp ? 'active' : ''} onClick={() => { setSignUp(true); setAuthError(''); }}>Create account</button></div>
          <h2 id="customer-auth-title">{signUp ? 'JOIN THE GAME.' : 'WELCOME BACK.'}</h2>
          <form onSubmit={authenticate}>
            {signUp && <label>Full name<input required name="displayName" maxLength={120} autoComplete="name"/></label>}
            <label>Email address<input required name="email" type="email" maxLength={254} autoComplete="email"/></label>
            {signUp && <label>Phone number <span className="cp-optional">(optional)</span><input name="phone" type="tel" autoComplete="tel" maxLength={24} placeholder="e.g. +94 70 123 4567"/></label>}
            <label>Password<input required name="password" type="password" minLength={signUp ? 12 : 1} maxLength={128} autoComplete={signUp ? 'new-password' : 'current-password'}/></label>
            {signUp && <p className="cp-form-note">Use at least 12 characters for your password.</p>}
            {authError && <p className="cp-error" role="alert">{authError}</p>}
            <button className="cp-primary" disabled={authPending}>{authPending ? 'Connecting…' : signUp ? 'Create player account' : 'Sign in'}<ArrowRight size={16}/></button>
          </form>
          <p className="cp-help">Need help with your booking? <a href="tel:+94701261966">Call 070 126 1966</a></p>
        </section>
      </div> : <>
        <div className="cp-account-bar"><span><Check size={16}/> {profile.data?.name}</span><span><Wallet size={16}/> Wallet {formatBookingMoney(profile.data?.walletBalance ?? '0', currency)}</span></div>
        <div className="cp-workspace-tabs" role="group" aria-label="Booking pages"><button type="button" className={tab === 'slots' ? 'active' : ''} onClick={() => setTab('slots')}>Find a session</button><button type="button" className={tab === 'bookings' ? 'active' : ''} onClick={() => setTab('bookings')}>My bookings</button></div>
        {(dataError || actionError) && <div className="cp-error" role="alert"><span>{actionError || dataError?.message}</span><button type="button" onClick={() => { setActionError(''); refresh(); }}>Retry</button></div>}
        {tab === 'slots' ? <>
          <section className="cp-filters" aria-label="Find a session">
            <label><MapPin size={16}/> Arena<select value={branch?.id ?? ''} onChange={(event) => { setSelectedBranch(event.target.value); setDate(''); }} disabled={!branches.length}>{branches.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
            <label><CalendarDays size={16}/> Date<input type="date" min={today} value={selectedDate} onChange={(event) => setDate(event.target.value || today)}/></label>
            <label>Lane type<select value={laneType} onChange={(event) => setLaneType(event.target.value)}><option value="ALL">All cricket lanes</option><option value="TURF_NET">Turf net</option><option value="BOWLING_MACHINE">Bowling machine</option></select></label>
            <div className="cp-date-nav"><button type="button" aria-label="Previous day" disabled={selectedDate <= today} onClick={() => setDate(shiftDay(selectedDate, -1))}><ChevronLeft size={18}/></button><button type="button" aria-label="Next day" onClick={() => setDate(shiftDay(selectedDate, 1))}><ChevronRight size={18}/></button><button type="button" aria-label="Refresh availability" onClick={refresh}><RefreshCw size={16}/></button></div>
          </section>
          <p className="cp-slot-note"><Clock3 size={15}/> Times shown in {timeZone.replaceAll('_', ' ')}. Choose a scheduled session to review the total.</p>
          {!permissions.includes('CREATE_UNPAID_HOLD') && Number(profile.data?.walletBalance ?? 0) === 0 && <p className="cp-error">Contact the club to enable reservations for your account.</p>}
          {branchQuery.isPending || availability.isFetching && !availability.data ? <section className="cp-state-card" role="status"><p>Checking live availability…</p></section> :
            !branch ? <section className="cp-state-card"><CalendarDays size={26}/><h2>Sessions are being prepared</h2><p>Contact the club to arrange your booking.</p><a href="tel:+94701261966" className="cp-primary">Call the club</a></section> :
            <div className="cp-lanes">{lanes.filter((lane) => laneType === 'ALL' || lane.type === laneType).map((lane) => {
              const choices = slots.filter((slot) => slot.laneId === lane.id).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
              return <section className="cp-lane-card" key={lane.id}><header><div><p>{lane.type === 'TURF_NET' ? 'TURF NET' : 'BOWLING MACHINE'}</p><h2>{lane.name}</h2></div><span>{choices.filter((slot) => slot.status === 'AVAILABLE').length} available</span></header>
                <div className="cp-time-grid">{choices.map((slot) => <button type="button" key={slot.id} disabled={slot.status !== 'AVAILABLE'}
                  aria-label={lane.name + ', ' + timeFormat(slot.startsAt, timeZone) + ' to ' + timeFormat(slot.endsAt, timeZone) + ', ' + (slot.status === 'AVAILABLE' ? formatBookingMoney(slot.price ?? 0, currency) : 'Unavailable')}
                  onClick={() => setSelection({ kind: 'new', slotId: slot.id })}><strong>{timeFormat(slot.startsAt, timeZone)} – {timeFormat(slot.endsAt, timeZone)}</strong><span>{slot.status === 'AVAILABLE' ? formatBookingMoney(slot.price ?? 0, currency) : slot.status === 'MAINTENANCE' ? 'Maintenance' : slot.status === 'UNPRICED' ? 'Contact club' : 'Reserved'}</span></button>)}</div>
                {!choices.length && <p className="cp-muted">No sessions scheduled for this date. Choose another date or call the club.</p>}
              </section>;
            })}</div>}
        </> : <section className="cp-bookings" aria-label="Your bookings">
          {reservations.isPending && <p role="status">Loading your bookings…</p>}
          {!reservations.isPending && !bookings.length && <div className="cp-state-card"><CalendarDays size={26}/><h2>Your next game starts here</h2><p>Your reserved sessions will appear here.</p><button className="cp-primary" onClick={() => setTab('slots')}>Find a session<ArrowRight size={16}/></button></div>}
          {bookings.map((booking) => <button type="button" className="cp-booking-row" key={booking.id} onClick={() => { void openBooking(booking.id); }}><span className="cp-booking-icon"><CalendarDays size={20}/></span><span className="cp-booking-name"><strong>{booking.slot?.laneName ?? 'Cricket session'}</strong><span>{booking.slot ? dateFormat(booking.slot.startsAt, booking.slot.timeZone ?? timeZone) + ' · ' + timeFormat(booking.slot.startsAt, booking.slot.timeZone ?? timeZone) + '–' + timeFormat(booking.slot.endsAt, booking.slot.timeZone ?? timeZone) : '#' + booking.id.slice(0, 8).toUpperCase()}</span></span><span className={'cp-booking-status ' + bookingState(booking).tone}>{bookingState(booking).label}</span><strong>{formatBookingMoney(booking.totalAmount, booking.currency)}</strong><ChevronRight size={18}/></button>)}
          {reservations.hasNextPage && <button className="cp-secondary" disabled={reservations.isFetchingNextPage} onClick={() => { void reservations.fetchNextPage(); }}>{reservations.isFetchingNextPage ? 'Loading…' : 'Load more bookings'}</button>}
        </section>}
      </>}
    </main>
    <footer className="cp-footer"><span>STRIKZ CLUB · Pitipana, Homagama</span><a href="tel:+94701261966"><Phone size={14}/> 070 126 1966</a><Link href="/dashboard">Staff dashboard <ArrowRight size={14}/></Link></footer>
    {selection && signedIn && <BookingDialog mode={selection} slots={dialogSlots} lanes={lanes} timezone={timeZone} currency={currency}
      staff={false} permissions={permissions} currentUser={{ id: principal.data!.userId, name: profile.data!.name }}
      walletBalance={profile.data?.walletBalance} actions={actions} token={token} onViewInvoice={setInvoiceId} onClose={() => setSelection(null)}/>}
    {invoiceId && <InvoiceDialog invoiceId={invoiceId} token={token} permissions={[]} onClose={() => setInvoiceId(null)} onChanged={refresh}/>}
  </div>;
}

