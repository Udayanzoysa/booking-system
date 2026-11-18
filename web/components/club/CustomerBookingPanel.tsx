'use client';

import { ArrowRight, CalendarDays, Clock3, MapPin, Phone, ShieldCheck, Users } from 'lucide-react';
import { civilDay } from '../../lib/dates';
import { bookingRangeSummary } from '../../lib/booking-range';
import type { CalendarSlot } from '../Calendar';
import { formatBookingMoney } from '../BookingDialog';

type Branch = { id: string; name: string };
type Props = {
  branches: Branch[];
  branchId: string;
  date: string;
  today: string;
  timeZone: string;
  currency: string;
  slots: CalendarSlot[];
  selectedSlot?: CalendarSlot;
  selectedSlots: CalendarSlot[];
  endSlots: CalendarSlot[];
  selectedEndSlotId: string;
  players: number;
  now: number;
  loading: boolean;
  signedIn: boolean;
  contactPhone: string;
  contactHref: string;
  onBranchChange: (id: string) => void;
  onDateChange: (date: string) => void;
  onSlotChange: (id: string) => void;
  onEndSlotChange: (id: string) => void;
  onPlayersChange: (players: number) => void;
  onContinue: (slot: CalendarSlot) => void;
};
const clock = (value: string, timeZone: string) => new Intl.DateTimeFormat('en-GB', {
  timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(value));

export function CustomerBookingPanel(props: Props) {
  const { selectedSlot: slot, timeZone, currency } = props;
  const range = bookingRangeSummary(props.selectedSlots);
  const selectedDate = slot ? civilDay(new Date(slot.startsAt), timeZone) : props.date;
  const daySlots = props.slots.filter(item => civilDay(new Date(item.startsAt), timeZone) === selectedDate && Date.parse(item.startsAt) > props.now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const available = Boolean(range && slot?.status === 'AVAILABLE' && Date.parse(slot.startsAt) > props.now);
  const inquiry = slot && ['HELD', 'RESERVED'].includes(slot.status) && Date.parse(slot.startsAt) > props.now;
  const summary = inquiry ? slot : range;
  const duration = summary ? (Date.parse(summary.endsAt) - Date.parse(summary.startsAt)) / 60_000 : 0;
  const durationLabel = duration % 60 === 0 ? `${duration / 60} ${duration === 60 ? 'hour' : 'hours'}` : `${duration} minutes`;
  return <aside className="cp-booking-panel" aria-labelledby="session-panel-title">
    <div className="cp-panel-title"><span className="cp-panel-icon"><CalendarDays size={21}/></span><div><p>YOUR GAME, YOUR TIME</p><h2 id="session-panel-title">Book your session</h2></div></div>
    <div className="cp-panel-fields">
      <label><span><MapPin size={14}/> Arena</span><select value={props.branchId} disabled={!props.branches.length} onChange={event => props.onBranchChange(event.target.value)}>
        {!props.branches.length && <option value="">Loading arena…</option>}
        {props.branches.map(branch => <option value={branch.id} key={branch.id}>{branch.name}</option>)}
      </select></label>
      <div className="cp-panel-field-pair"><label><span><CalendarDays size={14}/> Booking date</span><input type="date" min={props.today} value={selectedDate} onChange={event => props.onDateChange(event.target.value || props.today)}/></label>
        <label><span><Users size={14}/> Players</span><select value={props.players} onChange={event => props.onPlayersChange(Number(event.target.value))}>{Array.from({ length: 30 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} {index === 0 ? 'player' : 'players'}</option>)}</select></label>
      </div>
      <div className="cp-panel-field-pair cp-panel-time-pair"><label><span><Clock3 size={14}/> Start time</span><select value={slot?.id ?? ''} onChange={event => props.onSlotChange(event.target.value)} disabled={props.loading || !daySlots.length}>
        {!slot && <option value="">{props.loading ? 'Checking sessions…' : daySlots.length ? 'Choose start time' : 'No upcoming sessions'}</option>}
        {daySlots.map(item => <option key={item.id} value={item.id} disabled={!['AVAILABLE', 'HELD', 'RESERVED'].includes(item.status)}>
          {clock(item.startsAt, timeZone)}{item.status === 'AVAILABLE' ? '' : ['HELD','RESERVED'].includes(item.status) ? ' · Call club' : item.status === 'PAID' ? ' · Booked' : ' · Unavailable'}
        </option>)}
      </select></label><label><span><Clock3 size={14}/> End time</span><select value={inquiry ? slot?.id ?? '' : props.selectedEndSlotId} onChange={event => props.onEndSlotChange(event.target.value)} disabled={props.loading || !props.endSlots.length || Boolean(inquiry)}>
        {inquiry && slot ? <option value={slot.id}>{clock(slot.endsAt, timeZone)}</option> : <>
          {!props.selectedEndSlotId && <option value="">Choose end time</option>}
          {props.endSlots.map(item => <option key={item.id} value={item.id}>{clock(item.endsAt, timeZone)}</option>)}
        </>}
      </select></label></div>
    </div>
    <div className="cp-session-summary" aria-live="polite"><div className="cp-summary-ground"><div><strong>Full Turf</strong><span>Indoor Ground · {summary ? durationLabel : 'Choose your session'}</span></div><span className={'cp-session-tag ' + (inquiry ? 'inquiry' : available ? 'available' : '')}>{inquiry ? 'Call to arrange' : available ? 'Available' : 'Choose a time'}</span></div>
      <div className="cp-summary-total"><span>Session total</span><strong>{summary?.price != null ? formatBookingMoney(summary.price, currency) : '—'}</strong></div>
    </div>
    <div className="cp-panel-bottom">
      {inquiry ? <p className="cp-panel-explainer">Call the club to check this tentative reservation.</p> : !available && <p className="cp-panel-explainer">Choose an available start and end time, or contact the club.</p>}
      <button className="cp-primary cp-reserve-button" type="button" disabled={props.loading || !slot || !available && !inquiry} onClick={() => { if (slot) props.onContinue(slot); }}>{inquiry ? 'Check with the club' : props.signedIn ? 'Reserve this session' : 'Continue to booking'}{inquiry ? <Phone size={17}/> : <ArrowRight size={17}/>}</button>
      <p className="cp-panel-assurance"><ShieldCheck size={14}/>{props.signedIn ? 'Your booking stays in your player account' : 'Sign in with Google or email to reserve'}</p>
      <a className="cp-panel-help" href={props.contactHref}><Phone size={14}/> Need a hand? <strong>{props.contactPhone}</strong></a>
    </div>
  </aside>;
}
