'use client';

import { QueryClient, QueryClientProvider, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CalendarDays, Check, Clock3, LogOut, Phone, Wallet, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { io } from 'socket.io-client';
import { api, ApiError, apiOrigin, json } from '../../lib/api';
import { branchMidnight, civilDay, shiftDay } from '../../lib/dates';
import { BookingDialog, bookingState, formatBookingMoney, type Booking, type BookingActions, type BookingDialogMode } from '../BookingDialog';
import type { CalendarLane, CalendarSlot } from '../Calendar';
import { InvoiceDialog } from '../Invoices';
import { CustomerCalendar } from './CustomerCalendar';
import { CustomerCheckout } from './CustomerCheckout';
import { GoogleSignIn } from './GoogleSignIn';
import { CustomerBookingPanel } from './CustomerBookingPanel';

type PortalProps = { initialSport?: string; initialNow?: number; tenantSlug: string; branchId?: string };
type Session = { token: string; name: string; tenantSlug: string };
type Principal = { userId: string; tenantId: string; permissions: string[]; expiresAt: number; displayName: string; tenantSlug: string };
type SessionResponse = { session: Session; principal: Principal };
type Customer = { id: string; name: string; walletBalance: string; userId: string; googleLinked?: boolean };
type Branch = { id: string; code: string; name: string; timeZone: string };
type PublicArena = { name: string; currency: string; contactPhone: string; branches: Branch[] };
type Availability = { branchId: string; timeZone: string; currency: string; lanes: CalendarLane[]; slots: CalendarSlot[] };
type PlayerBooking = Booking & { latestBankTransferSlip?: { id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; reviewNote?: string | null; amount: string; createdAt: string } | null };
type BookingPage = { bookings: PlayerBooking[]; nextCursor: string | null };
const timeFormat = (value: string, timeZone: string) => new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const dateFormat = (value: string, timeZone: string) => new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'medium' }).format(new Date(value));
function phoneLink(phone: string) {
  const digits = phone.replace(/[^\d+]/g, '');
  return 'tel:' + (digits.startsWith('0') ? '+94' + digits.slice(1) : digits || '+94701261966');
}
async function requestSession(options?: RequestInit): Promise<SessionResponse | null> {
  const headers = new Headers(options?.headers);
  if (options?.body) headers.set('Content-Type', 'application/json');
  const response = await fetch('/api/session?scope=customer', { ...options, headers, cache: 'no-store', credentials: 'same-origin' });
  if (response.status === 401 && (!options?.method || options.method === 'GET')) return null;
  if (!response.ok) {
    const data: { message?: string | string[] } | null = await response.json().catch(() => null);
    throw new ApiError(response.status, [data?.message ?? 'Could not connect to your account.'].flat().join(' · '));
  }
  return response.status === 204 ? null : response.json() as Promise<SessionResponse>;
}
export default function CustomerPortal({ initialSport = 'cricket', initialNow = Date.now(), tenantSlug, branchId }: PortalProps) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000 } } }));
  return <QueryClientProvider client={client}><CustomerWorkspace sport={initialSport} initialNow={initialNow} customerTenant={tenantSlug} customerBranch={branchId}/></QueryClientProvider>;
}
function CustomerWorkspace({ sport, initialNow, customerTenant, customerBranch }: { sport: string; initialNow: number; customerTenant: string; customerBranch?: string }) {
  const cache = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [signUp, setSignUp] = useState(false);
  const [authPending, setAuthPending] = useState(false);
  const [authError, setAuthError] = useState('');
  const [googleLinkOpen, setGoogleLinkOpen] = useState(false);
  const [googleNotice, setGoogleNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [date, setDate] = useState('');
  const [chosenSlotId, setChosenSlotId] = useState('');
  const [players, setPlayers] = useState(6);
  const [tab, setTab] = useState<'slots' | 'bookings'>('slots');
  const [showHistory, setShowHistory] = useState(false);
  const [selection, setSelection] = useState<BookingDialogMode | null>(null);
  const [pendingSlotId, setPendingSlotId] = useState<string | null>(null);
  const [inquiry, setInquiry] = useState<CalendarSlot | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<Booking | null>(null);
  const [paymentReturn, setPaymentReturn] = useState('');
  const [now, setNow] = useState(initialNow);
  const token = session?.tenantSlug === customerTenant ? session.token : null;
  const differentArena = Boolean(session && session.tenantSlug !== customerTenant);
  const futsal = ['futsal', 'football'].includes(sport.toLowerCase());
  useEffect(() => {
    const controller = new AbortController();
    try { sessionStorage.removeItem('strikz-customer-session:' + customerTenant); } catch { /* Remove legacy browser token. */ }
    void requestSession({ signal: controller.signal }).then(result => { if (!controller.signal.aborted) setSession(result?.session ?? null); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setAuthError(reason instanceof Error ? reason.message : 'Could not restore your account.'); })
      .finally(() => { if (!controller.signal.aborted) setSessionReady(true); });
    return () => controller.abort();
  }, [customerTenant]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    const payment = new URLSearchParams(window.location.search).get('payment');
    if (payment === 'return' || payment === 'cancel') {
      setPaymentReturn(payment === 'cancel' ? 'Checkout was cancelled. Check your booking for its current payment status.' : 'Welcome back. Your payment status updates after PayHere sends a verified notification.');
      setTab('bookings');
    }
  }, []);
  const principal = useQuery({ queryKey: ['customer', token, 'principal'], queryFn: ({ signal }) => api<Principal>('/auth/me', token, { signal }), enabled: Boolean(token), refetchInterval: 30_000 });
  const profile = useQuery({ queryKey: ['customer', token, 'profile'], queryFn: ({ signal }) => api<Customer>('/customers/me', token, { signal }), enabled: Boolean(principal.data) });
  const signedIn = Boolean(token && principal.data && profile.data);
  const arena = useQuery({ queryKey: ['public-customer', customerTenant, 'arena'], queryFn: ({ signal }) => api<PublicArena>('/public/tenants/' + encodeURIComponent(customerTenant), null, { signal }), enabled: Boolean(customerTenant), refetchInterval: 30_000 });
  const branches = (arena.data?.branches ?? []).filter(item => !customerBranch || item.id === customerBranch);
  const branch = branches.find(item => item.id === selectedBranch) ?? branches[0];
  const timeZone = branch?.timeZone ?? 'Asia/Colombo';
  const today = civilDay(new Date(now), timeZone);
  const selectedDate = date || today;
  const query = new URLSearchParams({ startsAt: branchMidnight(selectedDate, timeZone), endsAt: branchMidnight(shiftDay(selectedDate, 7), timeZone) });
  const availability = useQuery({ queryKey: ['public-customer', customerTenant, 'availability', branch?.id, selectedDate, timeZone], queryFn: ({ signal }) => api<Availability>('/public/tenants/' + encodeURIComponent(customerTenant) + '/branches/' + branch!.id + '/availability?' + query, null, { signal }), enabled: Boolean(branch), refetchInterval: 30_000 });
  const reservations = useInfiniteQuery({ queryKey: ['customer', token, 'bookings'], initialPageParam: '', queryFn: ({ pageParam, signal }) => api<BookingPage>('/bookings?limit=30' + (pageParam ? '&cursor=' + encodeURIComponent(pageParam) : ''), token, { signal }), getNextPageParam: page => page.nextCursor ?? undefined, enabled: signedIn, refetchInterval: paymentReturn ? 5_000 : 30_000 });
  const lanes = availability.data?.lanes ?? [];
  const dialogSlots = (availability.data?.slots ?? []).filter(slot => Date.parse(slot.startsAt) > now).map(slot => ({ ...slot, staffed: false }));
  const daySlots = dialogSlots.filter(slot => civilDay(new Date(slot.startsAt), timeZone) === selectedDate).sort((a,b) => a.startsAt.localeCompare(b.startsAt));
  const chosenSlot = dialogSlots.find(slot => slot.id === chosenSlotId)
    ?? daySlots.find(slot => slot.status === 'AVAILABLE')
    ?? daySlots.find(slot => ['HELD','RESERVED'].includes(slot.status));
  const currency = availability.data?.currency ?? arena.data?.currency ?? 'LKR';
  const contactPhone = arena.data?.contactPhone || '070 126 1966';
  const contactHref = phoneLink(contactPhone);
  const permissions = principal.data?.permissions ?? [];
  const bookings = reservations.data?.pages.flatMap(page => page.bookings).filter(booking => booking.customerId === profile.data?.id) ?? [];
  const visibleBookings = bookings.filter(booking => showHistory || Boolean(booking.slot && Date.parse(booking.slot.endsAt) > now && ['HELD', 'CONFIRMED'].includes(booking.status))).sort((a,b) => (a.slot?.startsAt ?? '').localeCompare(b.slot?.startsAt ?? ''));
  const hasProfileError = profile.error instanceof ApiError && profile.error.status === 404;
  const expired = principal.error instanceof ApiError && principal.error.status === 401 || Boolean(principal.data && principal.data.expiresAt <= now);
  function refresh() { void cache.invalidateQueries({ queryKey: ['customer', token] }); void cache.invalidateQueries({ queryKey: ['public-customer', customerTenant] }); }
  async function clearSession(message = '') {
    setAuthPending(true);
    try {
      await requestSession({ method: 'DELETE' });
      setSession(null); setSelection(null); setInvoiceId(null); setCheckout(null); setGoogleLinkOpen(false); setGoogleNotice(''); setAuthError(message); setActionError(''); setTab('slots');
      cache.clear();
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Could not sign out.'); }
    finally { setAuthPending(false); }
  }
  useEffect(() => { if (expired) void clearSession('Your session has expired. Sign in to continue.'); }, [expired]);
  useEffect(() => {
    if (!customerTenant || !arena.data) return;
    const socket = io(apiOrigin + '/availability', { auth: signedIn && token ? { token } : { tenantSlug: customerTenant }, reconnectionAttempts: 3 });
    socket.on('availability.changed', refresh);
    return () => { socket.removeAllListeners(); socket.disconnect(); };
  }, [signedIn, token, cache, customerTenant, Boolean(arena.data)]);
  useEffect(() => {
    if (!signedIn) return;
    setAuthOpen(false);
    if (pendingSlotId) {
      if (!availability.data) return;
      const slot = dialogSlots.find(item => item.id === pendingSlotId);
      if (slot?.status === 'AVAILABLE') setSelection({ kind: 'new', slotId: slot.id });
      else setActionError('That session is no longer available online. Choose another session or call the club.');
      setPendingSlotId(null);
    }
  }, [signedIn, pendingSlotId, availability.data]);
  function acceptSession(result: SessionResponse) {
    cache.clear(); setSelection(null); setInvoiceId(null); setCheckout(null); setAuthError(''); setActionError(''); setSession(result.session);
  }
  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setAuthPending(true); setAuthError('');
    const fields = new FormData(event.currentTarget);
    try {
      const result = await requestSession(json('POST', { action: signUp ? 'register' : 'login', tenantSlug: customerTenant, email: String(fields.get('email')).trim(), password: String(fields.get('password')), ...(signUp ? { displayName: String(fields.get('displayName')).trim(), ...(fields.get('phone') ? { phone: String(fields.get('phone')).trim() } : {}) } : {}) }));
      if (!result) throw new Error('Could not open your player account.');
      acceptSession(result);
    } catch (reason) { setAuthError(reason instanceof Error ? reason.message : 'Could not sign in.'); }
    finally { setAuthPending(false); }
  }
  async function saveBooking(path: string, body: unknown) { const result = await api<Booking>(path, token, json('POST', body)); refresh(); return result; }
  const actions: BookingActions = {
    create: payload => saveBooking('/bookings', payload),
    cancel: (id, payload) => saveBooking('/bookings/' + id + '/cancel', payload),
    reschedule: (id, payload) => saveBooking('/bookings/' + id + '/reschedule', payload),
    async payment(id, kind, payload) {
      if (kind !== 'wallet-collections') throw new Error('Choose wallet payment for this booking.');
      await api('/payments/' + id + '/wallet-collections', token, json('POST', payload)); refresh(); return api<Booking>('/bookings/' + id, token);
    },
  };
  async function openBooking(id: string) {
    setActionError('');
    try { setSelection({ kind: 'detail', booking: await api<Booking>('/bookings/' + id, token) }); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Could not open your booking.'); }
  }
  function selectSlot(slot: CalendarSlot) {
    if (['HELD','RESERVED'].includes(slot.status)) { setInquiry(slot); return; }
    if (slot.status !== 'AVAILABLE') return;
    if (!signedIn) { setPendingSlotId(slot.id); setAuthOpen(true); return; }
    setSelection({ kind: 'new', slotId: slot.id });
  }
  function myBookings() { setTab('bookings'); if (!signedIn) setAuthOpen(true); }
  function changeDate(next: string) { setDate(next); setChosenSlotId(''); }
  const dataError = arena.error ?? availability.error ?? (signedIn ? reservations.error : null);
  const accountError = principal.error ?? profile.error;
  const authContent = <section className="cp-auth-card" aria-labelledby="customer-auth-title">
    <div className="cp-auth-tabs"><button type="button" className={!signUp ? 'active' : ''} onClick={() => { setSignUp(false); setAuthError(''); }}>Sign in</button><button type="button" className={signUp ? 'active' : ''} onClick={() => { setSignUp(true); setAuthError(''); }}>Create account</button></div>
    <h2 id="customer-auth-title">{signUp ? 'JOIN THE GAME.' : 'WELCOME BACK.'}</h2><p className="cp-auth-intro">Sign in to reserve Full Turf or manage your bookings.</p>
    {!sessionReady || token && !signedIn && !accountError ? <p role="status">Opening your player account…</p> : differentArena || hasProfileError ? <div className="cp-auth-account"><p>Your current customer login is not a player account for this arena. Use a Strikz Club player account to book.</p><button type="button" className="cp-secondary" disabled={authPending} onClick={() => void clearSession()}>Use another account</button></div> : <>
    <GoogleSignIn tenantSlug={customerTenant} disabled={authPending} onPendingChange={setAuthPending} onSuccess={acceptSession}/>
    <div className="cp-auth-divider"><span>or use your email</span></div>
    <form onSubmit={authenticate}>
      {signUp && <label>Full name<input required name="displayName" maxLength={120} autoComplete="name"/></label>}
      <label>Email address<input required name="email" type="email" maxLength={254} autoComplete="email"/></label>
      {signUp && <label>Phone number <span className="cp-optional">(optional)</span><input name="phone" type="tel" autoComplete="tel" maxLength={24} placeholder="e.g. +94 70 123 4567"/></label>}
      <label>Password<input required name="password" type="password" minLength={signUp ? 12 : 1} maxLength={128} autoComplete={signUp ? 'new-password' : 'current-password'}/></label>
      {signUp && <p className="cp-form-note">Use at least 12 characters for your password.</p>}
      {(authError || accountError) && <p className="cp-error" role="alert">{authError || accountError?.message}</p>}
      <button className="cp-primary" disabled={authPending}>{authPending ? 'Connecting…' : signUp ? 'Create player account' : 'Sign in'}<ArrowRight size={16}/></button>
    </form></>}
    <p className="cp-help">Need help with your booking? <a href={contactHref}>Call {contactPhone}</a></p>
  </section>;
  return <div className="customer-portal cp-customer-booking">
    <header className="cp-header"><Link href="/" className="cp-wordmark" aria-label="Strikz Club home"><i aria-hidden="true"><b/><b/><b/></i>STRIKZ <span>CLUB</span></Link><nav aria-label="Booking navigation"><Link href="/"><ArrowLeft size={15}/> Back to club</Link>{session ? <button type="button" disabled={authPending} onClick={() => void clearSession()}><LogOut size={15}/> Sign out</button> : <button type="button" className="cp-player-sign-in" onClick={() => setAuthOpen(true)}>Player sign in <ArrowRight size={15}/></button>}</nav></header>
    <main className="cp-main"><div className="cp-page-top"><div className="cp-heading"><p className="cp-eyebrow">FULL TURF · HOMAGAMA</p><h1>BOOK YOUR <em>NEXT GAME.</em></h1><p>Choose your time. Bring your team. Make it a game to remember.</p></div><div className="cp-workspace-tabs" role="group" aria-label="Booking pages"><button type="button" className={tab === 'slots' ? 'active' : ''} onClick={() => setTab('slots')}>Book a session</button><button type="button" className={tab === 'bookings' ? 'active' : ''} onClick={myBookings}>My bookings</button></div></div>
      {!customerTenant ? <section className="cp-state-card"><Phone size={25}/><h2>Arrange your session with the club</h2><p>Call to check available times and prices.</p><a href={contactHref} className="cp-primary">{contactPhone}</a></section> : <>
        {signedIn && <div className="cp-account-bar"><span><Check size={16}/> {profile.data?.name}</span><div className="cp-account-actions">{profile.data?.googleLinked ? <span className="cp-google-connected"><Check size={14}/>Google connected</span> : <button className="cp-google-connect" type="button" onClick={() => { setGoogleNotice(''); setGoogleLinkOpen(true); }}>Connect Google</button>}<span><Wallet size={16}/> Wallet {formatBookingMoney(profile.data?.walletBalance ?? '0', currency)}</span></div></div>}
        {googleNotice && <p className="cp-google-success" role="status"><Check size={15}/>{googleNotice}</p>}
        {futsal && <p className="cp-sport-note">Planning futsal? Call <a href={contactHref}>{contactPhone}</a> to confirm the ground setup for your team.</p>}
        {paymentReturn && <div className="cp-payment-return" role="status"><Clock3 size={18}/><span>{paymentReturn}</span><button type="button" onClick={() => setPaymentReturn('')}>Dismiss</button></div>}
        {(dataError || actionError) && <div className="cp-error" role="alert"><span>{actionError || dataError?.message}</span><button type="button" onClick={() => { setActionError(''); refresh(); }}>Retry</button></div>}
        {tab === 'slots' ? <div className="cp-booking-layout">
          <div className="cp-calendar-pane">{arena.isPending || availability.isFetching && !availability.data ? <section className="cp-state-card" role="status"><CalendarDays size={26}/><p>Finding your next session…</p></section> : !branch ? <section className="cp-state-card"><CalendarDays size={26}/><h2>Sessions are being prepared</h2><p>Contact the club to arrange your booking.</p><a href={contactHref} className="cp-primary">Call the club</a></section> : <CustomerCalendar date={selectedDate} today={today} now={now} timeZone={timeZone} currency={currency} lanes={lanes} slots={availability.data?.slots ?? []} selectedSlotId={chosenSlot?.id} loading={availability.isFetching} onDateChange={changeDate} onRefresh={refresh} onSlotSelect={slot => setChosenSlotId(slot.id)}/>}</div>
          <CustomerBookingPanel branches={branches} branchId={branch?.id ?? ''} date={selectedDate} today={today} now={now} timeZone={timeZone} currency={currency} slots={availability.data?.slots ?? []} selectedSlot={chosenSlot} players={players} signedIn={signedIn} loading={arena.isPending || availability.isFetching && !availability.data} contactPhone={contactPhone} contactHref={contactHref} onBranchChange={id => { setSelectedBranch(id); setDate(''); setChosenSlotId(''); }} onDateChange={changeDate} onSlotChange={setChosenSlotId} onPlayersChange={setPlayers} onContinue={selectSlot}/>
        </div> : !signedIn ? <section className="cp-state-card"><CalendarDays size={27}/><h2>Your sessions, all in one place</h2><p>Sign in to see payment balances and transfer slip updates.</p><button className="cp-primary" onClick={() => setAuthOpen(true)}>Player sign in<ArrowRight size={16}/></button></section> : <section className="cp-bookings" aria-label="Your bookings">
          <div className="cp-booking-list-heading"><h2>{showHistory ? 'All your bookings' : 'Current & upcoming bookings'}</h2><button type="button" className="cp-text-link" onClick={() => setShowHistory(!showHistory)}>{showHistory ? 'Show upcoming' : 'Include booking history'}</button></div>
          {reservations.isPending && <p role="status">Loading your bookings…</p>}
          {!reservations.isPending && !visibleBookings.length && <div className="cp-state-card"><CalendarDays size={26}/><h2>{showHistory ? 'Your next game starts here' : 'No upcoming sessions yet'}</h2><p>Choose an available Full Turf session on the calendar.</p><button className="cp-primary" onClick={() => setTab('slots')}>Find a session<ArrowRight size={16}/></button></div>}
          {visibleBookings.map(booking => <PlayerBookingCard key={booking.id} booking={booking} now={now} timeZone={timeZone} onOpen={() => void openBooking(booking.id)} onPay={() => setCheckout(booking)}/>)}
          {reservations.hasNextPage && <button className="cp-secondary" disabled={reservations.isFetchingNextPage} onClick={() => void reservations.fetchNextPage()}>{reservations.isFetchingNextPage ? 'Loading…' : 'Load more bookings'}</button>}
        </section>}
      </>}
    </main><footer className="cp-footer"><span>STRIKZ CLUB · Pitipana, Homagama</span><a href={contactHref}><Phone size={14}/> {contactPhone}</a></footer>
    {authOpen && !signedIn && <PortalModal title="Player account" onClose={() => { if (!authPending) { setAuthOpen(false); setPendingSlotId(null); } }}>{authContent}</PortalModal>}
    {googleLinkOpen && signedIn && <PortalModal title="Connect your Google account" onClose={() => { if (!authPending) setGoogleLinkOpen(false); }}><div className="cp-google-link-panel"><p>Connect Google so you can sign in to your player account without entering a password next time.</p><GoogleSignIn tenantSlug={customerTenant} mode="link" disabled={authPending} onPendingChange={setAuthPending} onSuccess={(result) => { setGoogleLinkOpen(false); acceptSession(result); setGoogleNotice('Google connected. You can now use Continue with Google to sign in.'); }}/></div></PortalModal>}
    {inquiry && <PortalModal title="Arrange this session with the club" onClose={() => setInquiry(null)}><div className="cp-inquiry"><span className="cp-inquiry-badge">Available · Call club</span><h3>Full Turf · Indoor Ground</h3><p>{dateFormat(inquiry.startsAt, timeZone)} · {timeFormat(inquiry.startsAt, timeZone)}–{timeFormat(inquiry.endsAt, timeZone)}</p>{inquiry.price && <strong>{formatBookingMoney(inquiry.price, currency)}</strong>}<p>This session has a tentative or deposit reservation. The club can confirm availability and help arrange your booking.</p><a href={contactHref} className="cp-primary"><Phone size={18}/>Call {contactPhone}</a></div></PortalModal>}
    {selection && signedIn && <BookingDialog mode={selection} slots={dialogSlots} lanes={lanes} timezone={timeZone} currency={currency} staff={false} permissions={permissions} currentUser={{ id: principal.data!.userId, name: profile.data!.name }} walletBalance={profile.data?.walletBalance} initialHeadcount={players} actions={actions} token={token} onViewInvoice={setInvoiceId} onCheckout={booking => { setSelection(null); setCheckout(booking); }} onClose={() => setSelection(null)}/>}
    {checkout && signedIn && token && <CustomerCheckout key={checkout.id} booking={checkout} token={token} timeZone={timeZone} contactPhone={contactPhone} onClose={() => { setCheckout(null); refresh(); }} onChanged={refresh}/>}
    {invoiceId && <InvoiceDialog invoiceId={invoiceId} token={token} permissions={[]} onClose={() => setInvoiceId(null)} onChanged={refresh}/>}
  </div>;
}
function PlayerBookingCard({ booking, timeZone, now, onOpen, onPay }: { booking: PlayerBooking; timeZone: string; now: number; onOpen: () => void; onPay: () => void }) {
  const zone = booking.slot?.timeZone ?? timeZone;
  const active = Boolean(booking.slot && Date.parse(booking.slot.startsAt) > now && (booking.status === 'CONFIRMED' || booking.status === 'HELD' && booking.holdExpiresAt && Date.parse(booking.holdExpiresAt) > now));
  const slip = booking.latestBankTransferSlip;
  return <article className="cp-player-booking"><header><div><span className="cp-eyebrow">INDOOR GROUND</span><h3>{booking.slot?.laneName ?? 'Full Turf'}</h3><p>{booking.slot ? dateFormat(booking.slot.startsAt, zone) + ' · ' + timeFormat(booking.slot.startsAt, zone) + '–' + timeFormat(booking.slot.endsAt, zone) : '#' + booking.id.slice(0,8).toUpperCase()}</p></div><span className={'cp-booking-status ' + bookingState(booking).tone}>{bookingState(booking).label}</span></header>
    <dl className="cp-booking-balances"><div><dt>Total</dt><dd>{formatBookingMoney(booking.totalAmount, booking.currency)}</dd></div><div><dt>Paid</dt><dd>{formatBookingMoney(booking.amountPaid, booking.currency)}</dd></div><div><dt>Balance due</dt><dd>{formatBookingMoney(booking.balanceDue, booking.currency)}</dd></div></dl>
    {booking.status === 'HELD' && booking.holdExpiresAt && <p className="cp-booking-hold"><Clock3 size={14}/>{Date.parse(booking.holdExpiresAt) > now ? 'Hold expires ' : 'Hold expired '}{dateFormat(booking.holdExpiresAt, zone)} at {timeFormat(booking.holdExpiresAt, zone)}</p>}
    <div className="cp-player-slip"><span>Transfer slip: <strong>{slip ? slip.status === 'PENDING' ? 'Awaiting review' : slip.status === 'APPROVED' ? 'Approved' : 'Rejected' : 'Not submitted'}</strong></span>{slip?.reviewNote && <p>Staff note: {slip.reviewNote}</p>}</div>
    <footer><button type="button" className="cp-secondary" onClick={onOpen}>View booking</button>{active && Number(booking.balanceDue) > 0 && <button type="button" className="cp-primary" onClick={onPay}>Pay / Upload slip<ArrowRight size={15}/></button>}</footer>
  </article>;
}
function PortalModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null); const titleId = useId();
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="cp-portal-modal" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}><header><h2 id={titleId}>{title}</h2><button type="button" aria-label="Close" onClick={onClose}><X size={20}/></button></header>{children}</dialog>;
}
