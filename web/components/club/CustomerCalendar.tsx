'use client';

import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { civilDay, shiftDay } from '../../lib/dates';
import { formatBookingMoney } from '../BookingDialog';
import type { CalendarLane, CalendarSlot } from '../Calendar';
import '../../app/customer-calendar.css';

type Props = {
  date: string; today: string; timeZone: string; currency: string; now: number;
  lanes: CalendarLane[]; slots: CalendarSlot[]; loading?: boolean;
  selectedSlotId?: string;
  onDateChange: (date: string) => void; onSlotSelect: (slot: CalendarSlot) => void; onRefresh: () => void;
};
const labels = { AVAILABLE: 'Available', RESERVED: 'Available · Call club', PAID: 'Already booked', HELD: 'Available · Call club', MAINTENANCE: 'Maintenance', UNPRICED: 'Contact club' };
const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
const clock = (value: string, timeZone: string) => new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
const minutes = (value: string, timeZone: string) => { const [hour, minute] = clock(value, timeZone).split(':').map(Number); return hour * 60 + minute; };

export function CustomerCalendar({ date, today, timeZone, currency, now, lanes, slots, loading, selectedSlotId, onDateChange, onSlotSelect, onRefresh }: Props) {
  const [view, setView] = useState<'day' | 'week'>('day');
  const selected = slots.find(slot => slot.id === selectedSlotId);
  const displayDate = view === 'day' && selected ? civilDay(new Date(selected.startsAt), timeZone) : date;
  const days = Array.from({ length: view === 'week' ? 7 : 1 }, (_, index) => shiftDay(displayDate, index));
  const visible = slots.filter((slot) => lanes.some((lane) => lane.id === slot.laneId) && days.includes(civilDay(new Date(slot.startsAt), timeZone)));
  const startHour = Math.max(0, Math.min(7, ...visible.map((slot) => Math.floor(minutes(slot.startsAt, timeZone) / 60))));
  const endHour = Math.min(24, Math.max(22, ...visible.map((slot) => {
    const end = civilDay(new Date(slot.endsAt), timeZone) !== civilDay(new Date(slot.startsAt), timeZone) ? 1440 : minutes(slot.endsAt, timeZone);
    return Math.ceil(end / 60);
  })));
  const totalMinutes = (endHour - startHour) * 60;
  const columns = view === 'day' ? lanes.map((lane) => ({ key: lane.id, label: lane.name, note: 'Indoor Ground' }))
    : days.map((day) => ({ key: day, label: dateLabel(day, { weekday: 'short', day: 'numeric' }), note: dateLabel(day, { month: 'short' }) }));
  const count = visible.filter((slot) => slot.status === 'AVAILABLE' && Date.parse(slot.startsAt) > now).length;
  const hourMarks = Array.from({ length: endHour - startHour }, (_, index) => ({
    label: String(startHour + index).padStart(2, '0') + ':00', top: index * 60 / totalMinutes * 100,
  }));
  return <section className={'cp-calendar cp-calendar-compact' + (view === 'week' ? ' is-week' : '')} aria-label="Live booking calendar">
    <header className="cp-calendar-toolbar">
      <div className="cp-calendar-heading"><CalendarDays size={18}/><div><h2>{dateLabel(displayDate, { day: 'numeric', month: 'long', ...(view === 'day' ? { year: 'numeric' } : {}) })}{view === 'week' && ' – ' + dateLabel(days[6], { day: 'numeric', month: 'short' })}</h2><p>{count} available {count === 1 ? 'session' : 'sessions'}</p></div></div>
      <div className="cp-calendar-controls">
        <div className="cp-calendar-view" role="group" aria-label="Calendar view"><button type="button" aria-pressed={view === 'day'} onClick={() => setView('day')}>Day</button><button type="button" aria-pressed={view === 'week'} onClick={() => setView('week')}>Week</button></div>
        <button type="button" className="cp-calendar-today" onClick={() => onDateChange(today)}>Today</button>
        <button type="button" aria-label={'Previous ' + view} disabled={displayDate <= today} onClick={() => onDateChange(shiftDay(displayDate, view === 'day' ? -1 : -7) < today ? today : shiftDay(displayDate, view === 'day' ? -1 : -7))}><ChevronLeft size={17}/></button>
        <button type="button" aria-label={'Next ' + view} onClick={() => onDateChange(shiftDay(displayDate, view === 'day' ? 1 : 7))}><ChevronRight size={17}/></button>
        <button type="button" aria-label="Refresh calendar" disabled={loading} onClick={onRefresh}><RefreshCw size={15} className={loading ? 'cp-spinning' : ''}/></button>
      </div>
    </header>
    <div className="cp-calendar-legend"><span><i className="available"/>Book online</span><span><i className="held"/>Call club</span><span><i className="reserved"/>Booked</span><span><i className="maintenance"/>Unavailable</span><small>{timeZone.replaceAll('_', ' ')}</small></div>
    {!columns.length ? <div className="cp-calendar-empty">No ground is configured yet.</div> : <div className="cp-calendar-scroll" aria-label="Session times">
      <div className={'cp-calendar-grid ' + (view === 'week' ? 'cp-calendar-week' : '')} style={{ '--cp-columns': columns.length } as CSSProperties}>
        <div className="cp-calendar-corner">TIME</div>
        {columns.map((column) => <div className="cp-calendar-column-title" key={column.key}><strong>{column.label}</strong><span>{column.note}</span></div>)}
        <div className="cp-calendar-hours">{hourMarks.map(mark => <span key={mark.label} style={{ top: mark.top + '%' }}>{mark.label}</span>)}</div>
        {columns.map((column) => <div className="cp-calendar-day" key={column.key}>
          {hourMarks.map(mark => <i key={mark.label} className="cp-calendar-hour-rule" aria-hidden="true" style={{ top: mark.top + '%' }}/>) }
          {visible.filter((slot) => view === 'day' ? slot.laneId === column.key : civilDay(new Date(slot.startsAt), timeZone) === column.key).map((slot) => {
            const laneIndex = Math.max(0, lanes.findIndex((lane) => lane.id === slot.laneId));
            const duration = Math.min(1440 - minutes(slot.startsAt, timeZone), (Date.parse(slot.endsAt) - Date.parse(slot.startsAt)) / 60_000);
            const available = slot.status === 'AVAILABLE' && Date.parse(slot.startsAt) > now;
            const inquiry = ['HELD', 'RESERVED'].includes(slot.status) && Date.parse(slot.startsAt) > now;
            const lane = lanes[laneIndex];
            const selected = slot.id === selectedSlotId;
            return <button type="button" key={slot.id} disabled={!available && !inquiry} aria-pressed={available || inquiry ? selected : undefined} className={'cp-calendar-slot ' + slot.status.toLowerCase() + (selected ? ' is-selected' : '')}
              style={{ top: `calc(${(minutes(slot.startsAt, timeZone) - startHour * 60) / totalMinutes * 100}% + 2px)`, height: `calc(${duration / totalMinutes * 100}% - 4px)`, ...(view === 'week' ? { width: `calc(${100 / lanes.length}% - 6px)`, left: `calc(${laneIndex * 100 / lanes.length}% + 3px)` } : {}) }}
              aria-label={`${dateLabel(civilDay(new Date(slot.startsAt), timeZone), { weekday: 'long', day: 'numeric', month: 'long' })}, ${lane?.name}, ${clock(slot.startsAt, timeZone)} to ${clock(slot.endsAt, timeZone)}, ${available ? formatBookingMoney(slot.price ?? 0, currency) + ', available' : labels[slot.status]}`}
              onClick={() => onSlotSelect(slot)}>
              <strong>{clock(slot.startsAt, timeZone)}–{clock(slot.endsAt, timeZone)}</strong>
              {view === 'week' && lanes.length > 1 && <span className="cp-calendar-slot-lane">{lane?.name}</span>}
              <span>{slot.status === 'PAID' ? 'Already booked' : available ? formatBookingMoney(slot.price ?? 0, currency) : Date.parse(slot.startsAt) <= now ? 'Past session' : labels[slot.status]}</span>
            </button>;
          })}
        </div>)}
      </div>
    </div>}
    {!visible.length && <p className="cp-calendar-empty">No sessions scheduled for this {view}. Choose another date or call the club.</p>}
  </section>;
}
