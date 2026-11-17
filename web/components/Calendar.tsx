"use client";

import {
  Activity, AlertTriangle, ArrowRight, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight,
  CircleDollarSign, Clock3, Grid2X2, Plus, Wrench, Zap,
} from "lucide-react";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { shiftDay, weekStart } from "../lib/dates";

export type CalendarLane = {
  id: string;
  name: string;
  type: "TURF_NET" | "BOWLING_MACHINE";
};

export type CalendarStatus = "AVAILABLE" | "UNPRICED" | "MAINTENANCE" | "HELD" | "PAID" | "RESERVED";

export type CalendarSlot = {
  id: string;
  laneId: string;
  startsAt: string;
  endsAt: string;
  status: CalendarStatus;
  kind?: "BOOKABLE" | "MAINTENANCE";
  price: string | null;
  pricingTiers?: ("PEAK" | "OFF_PEAK")[];
  staffed: boolean;
  booking?: {
    id: string;
    label: string;
    headcount: number;
    amountPaid: string;
    holdExpiresAt?: string | null;
  };
};

type CalendarProps = {
  date: string;
  today: string;
  onDateChange: (date: string) => void;
  timeZone: string;
  currency: string;
  lanes: CalendarLane[];
  slots: CalendarSlot[];
  branchName?: string;
  branchControl?: ReactNode;
  onSlotSelect: (slot: CalendarSlot) => void;
  onNewBooking: () => void;
  loading?: boolean;
  canBook?: boolean;
};

type DateRange = { start: number; end: number };
type DaySlot = DateRange & { slot: CalendarSlot };
type StatusFilter = CalendarStatus | "ALL" | "UNPAID";
type LaneFilter = CalendarLane["type"] | "ALL";

const HOUR_HEIGHT = 67;
const LANE_LABEL = { TURF_NET: "Turf net", BOWLING_MACHINE: "Bowling machine" };

const STATUS: Record<CalendarStatus, { label: string; css: string }> = {
  AVAILABLE: { label: "Available", css: "available" },
  UNPRICED: { label: "Rate needed", css: "unpriced" },
  MAINTENANCE: { label: "Maintenance", css: "maintenance" },
  HELD: { label: "Tentative hold", css: "held" },
  PAID: { label: "Paid", css: "paid" },
  RESERVED: { label: "Reserved", css: "reserved" },
};

function weekOf(date: string) {
  const monday = weekStart(date);
  return Array.from({ length: 7 }, (_, index) => shiftDay(monday, index));
}

function formatDay(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(
    new Date(date + "T12:00:00Z"),
  );
}

function calendarClock(timeZone: string) {
  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });

  return (instant: string) => {
    const parts = format.formatToParts(new Date(instant));
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
    return {
      date: [value("year"), value("month"), value("day")].join("-"),
      minute: Number(value("hour")) * 60 + Number(value("minute")),
    };
  };
}

function slotTime(minute: number) {
  return [Math.floor(minute / 60), minute % 60].map((value) => String(value).padStart(2, "0")).join(":");
}

function isReservation(slot: CalendarSlot) {
  return slot.status === "PAID" || slot.status === "RESERVED" || slot.status === "HELD";
}

function intersects(first: DateRange, second: DateRange) {
  return first.start < second.end && second.start < first.end;
}

function isMaintenanceBlock(slot: CalendarSlot) {
  return slot.status === "MAINTENANCE" && slot.kind !== "BOOKABLE";
}

function summarizeSlots(slots: DaySlot[]) {
  const bookings = new Map<string, DaySlot>();
  const maintenanceByLane = new Map<string, DaySlot[]>();
  const reservedByLane = new Map<string, DaySlot[]>();

  for (const entry of slots) {
    const { slot } = entry;
    if (isMaintenanceBlock(slot)) {
      const blocks = maintenanceByLane.get(slot.laneId) ?? [];
      blocks.push(entry);
      maintenanceByLane.set(slot.laneId, blocks);
    }
    if (isReservation(slot) && slot.booking && !bookings.has(slot.booking.id)) {
      bookings.set(slot.booking.id, entry);
      const blocks = reservedByLane.get(slot.laneId) ?? [];
      blocks.push(entry);
      reservedByLane.set(slot.laneId, blocks);
    }
  }

  return slots.filter((entry) => {
    const { slot } = entry;
    if (isMaintenanceBlock(slot)) return true;
    if (isReservation(slot) && slot.booking) return bookings.get(slot.booking.id) === entry;

    return ![...(maintenanceByLane.get(slot.laneId) ?? []), ...(reservedByLane.get(slot.laneId) ?? [])]
      .some((block) => intersects(entry, block));
  });
}

function rangeSizeByLane(entries: DaySlot[]) {
  const ranges = new Map<string, DateRange[]>();
  for (const entry of entries) {
    const laneEntries = ranges.get(entry.slot.laneId) ?? [];
    laneEntries.push(entry);
    ranges.set(entry.slot.laneId, laneEntries);
  }

  let minutes = 0;
  for (const laneEntries of ranges.values()) {
    let lastEnd = 0;
    for (const { start, end } of laneEntries.sort((left, right) => left.start - right.start)) {
      minutes += Math.max(0, end - Math.max(start, lastEnd));
      lastEnd = Math.max(lastEnd, end);
    }
  }
  return minutes;
}

function matchesStatus(status: StatusFilter, slot: CalendarSlot) {
  if (status === "ALL") return true;
  if (status === "UNPAID") return slot.status === "RESERVED" || slot.status === "HELD";
  return slot.status === status;
}

function positionSlots(slots: DaySlot[]) {
  const groups: { columns: number[]; entries: (DaySlot & { column: number })[]; end: number }[] = [];
  for (const slot of [...slots].sort((left, right) => left.start - right.start || left.end - right.end)) {
    let group = groups.at(-1);
    if (!group || group.end <= slot.start) {
      group = { columns: [], entries: [], end: slot.end };
      groups.push(group);
    }
    const free = group.columns.findIndex((end) => end <= slot.start);
    const column = free === -1 ? group.columns.length : free;
    group.columns[column] = slot.end;
    group.entries.push({ ...slot, column });
    group.end = Math.max(group.end, slot.end);
  }
  return groups.flatMap(({ columns, entries }) => entries.map((entry) => ({ ...entry, columnCount: columns.length })));
}

export default function Calendar({
  date, today, onDateChange, timeZone, currency, lanes, slots, onSlotSelect, onNewBooking,
  branchName, branchControl, loading, canBook = true,
}: CalendarProps) {
  const [view, setView] = useState<"DAY" | "WEEK">("DAY");
  const [laneFilter, setLaneFilter] = useState<LaneFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const week = useMemo(() => weekOf(date), [date]);
  const clock = useMemo(() => calendarClock(timeZone), [timeZone]);
  const money = useMemo(() => new Intl.NumberFormat("en-LK", {
    style: "currency", currency, currencyDisplay: "code", minimumFractionDigits: 0, maximumFractionDigits: 2,
  }), [currency]);
  const daySlots = useMemo(() => {
    const days = new Map<string, DaySlot[]>(week.map((day) => [day, []]));
    for (const slot of slots) {
      const starts = clock(slot.startsAt);
      const ends = clock(slot.endsAt);
      for (const [day, entries] of days) {
        if (day < starts.date || day > ends.date) continue;
        const start = day === starts.date ? starts.minute : 0;
        const end = day === ends.date ? ends.minute : 1440;
        if (start < end) entries.push({ slot, start, end });
      }
    }
    return new Map([...days].map(([day, entries]) => [day, summarizeSlots(entries)]));
  }, [slots, clock, week]);

  const daily = daySlots.get(date) ?? [];
  const displayLanes = lanes.filter((lane) => laneFilter === "ALL" || lane.type === laneFilter);
  const visibleLanes = new Set(displayLanes.map((lane) => lane.id));
  const visibleSlots = daily.filter(({ slot }) => visibleLanes.has(slot.laneId) && matchesStatus(statusFilter, slot));
  const reservations = daily.filter(({ slot }) => isReservation(slot));
  const pending = reservations.filter(({ slot }) => slot.status === "HELD" || slot.status === "RESERVED");
  const paid = reservations.filter(({ slot }) => slot.status === "PAID").length;
  const confirmed = reservations.filter(({ slot }) => slot.status !== "HELD").length;
  const received = reservations.reduce((amount, { slot }) => amount + Number(slot.booking?.amountPaid ?? 0), 0);
  const openHours = rangeSizeByLane(daily.filter(({ slot }) => slot.status !== "MAINTENANCE" && slot.status !== "UNPRICED"));
  const utilization = openHours ? Math.round(rangeSizeByLane(reservations) / openHours * 100) : 0;
  const unstaffed = daily.filter(({ slot }) => slot.status !== "MAINTENANCE" && !slot.staffed);
  const shownStart = Math.floor(Math.min(420, ...daily.map(({ start }) => start)) / 60) * 60;
  const shownEnd = Math.ceil(Math.max(1380, ...daily.map(({ end }) => end)) / 60) * 60;
  const hourCount = (shownEnd - shownStart) / 60;
  const dateTitle = formatDay(date, { day: "numeric", month: "long", year: "numeric" });
  const spanTitle = formatDay(week[0], { day: "numeric", month: "short" }) + " – " +
    formatDay(week[6], { day: "numeric", month: "short", year: "numeric" });

  const stats = [
    { label: date === today ? "Bookings today" : "Daily bookings", value: reservations.length,
      foot: confirmed + " confirmed · " + (reservations.length - confirmed) + " on hold", Icon: CalendarDays, color: "blue" },
    { label: "Lane utilization", value: utilization + "%", foot: "Of scheduled lane time", Icon: Activity, color: "violet" },
    { label: "Payments received", value: money.format(received), foot: "For the selected day", Icon: CircleDollarSign, color: "green" },
    { label: "Needs attention", value: pending.length, foot: pending.length ? "Holds and outstanding balances" : "No outstanding bookings", Icon: Clock3, color: "amber" },
  ];
  const layout = { "--cal-column-count": Math.max(1, displayLanes.length) } as CSSProperties;

  return (
    <div className="tw-calendar">
      <div className="cal-heading">
        <div>
          <h1>Booking calendar</h1>
          <p>See availability, manage bookings, and follow up on payments.</p>
        </div>
        <div className="cal-heading-controls">
          {branchControl}
          {canBook && <button type="button" className="cal-new" onClick={onNewBooking}><Plus size={18} /> New booking</button>}
        </div>
      </div>

      <section className="cal-stats" aria-label="Day metrics">
        {stats.map(({ label, value, foot, Icon, color }) => (
          <article className="cal-stat" key={label}>
            <div>
              <p className="cal-stat-label">{label}</p>
              <strong>{loading ? "—" : value}</strong>
              <small>{foot}</small>
            </div>
            <span className={"cal-icon cal-icon-" + color}><Icon size={19} aria-hidden="true" /></span>
          </article>
        ))}
      </section>

      <div className="cal-body">
        <section className="cal-panel" aria-label="Lane availability" aria-busy={loading}>
          <div className="cal-toolbar">
            <div className="cal-toolbar-left">
              <div className="cal-nav">
                <button type="button" className="cal-square" aria-label={"Previous " + view.toLowerCase()} onClick={() => onDateChange(shiftDay(date, view === "DAY" ? -1 : -7))}><ChevronLeft size={16}/></button>
                <button type="button" className="cal-square" aria-label={"Next " + view.toLowerCase()} onClick={() => onDateChange(shiftDay(date, view === "DAY" ? 1 : 7))}><ChevronRight size={16}/></button>
              </div>
              <h2>{view === "DAY" ? dateTitle : spanTitle}</h2>
              <button type="button" className="cal-today" onClick={() => onDateChange(today)}>Today</button>
            </div>
            <div className="cal-toolbar-right">
              <label className="cal-select">
                <select aria-label="Lane type" value={laneFilter} onChange={(event) => setLaneFilter(event.target.value as LaneFilter)}>
                  <option value="ALL">All lane types</option>
                  <option value="TURF_NET">Turf nets</option>
                  <option value="BOWLING_MACHINE">Bowling machines</option>
                </select>
                <ChevronDown size={13} aria-hidden="true" />
              </label>
              <label className="cal-select">
                <select aria-label="Booking status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
                  <option value="ALL">All statuses</option>
                  <option value="UNPAID">Payments due</option>
                  {Object.entries(STATUS).map(([status, { label }]) => <option key={status} value={status}>{label}</option>)}
                </select>
                <ChevronDown size={13} aria-hidden="true" />
              </label>
              <div className="cal-view" role="group" aria-label="Calendar view">
                <button type="button" aria-pressed={view === "DAY"} onClick={() => setView("DAY")}>Day</button>
                <button type="button" aria-pressed={view === "WEEK"} onClick={() => setView("WEEK")}>Week</button>
              </div>
            </div>
          </div>

          <div className="cal-weekstrip" aria-label="Dates this week">
            {week.map((day) => {
              const bookings = (daySlots.get(day) ?? []).filter(({ slot }) => isReservation(slot)).length;
              return (
                <button type="button" key={day} className="cal-date" aria-pressed={day === date}
                  aria-label={formatDay(day, { weekday: "long", day: "numeric", month: "long" })}
                  onClick={() => onDateChange(day)}>
                  <small>{formatDay(day, { weekday: "short" })}</small>
                  <strong>{Number(day.slice(-2))}</strong>
                  <span>{bookings === 1 ? "1 booking" : bookings + " bookings"}</span>
                </button>
              );
            })}
          </div>

          <div className="cal-legend">
            {(["PAID", "RESERVED", "HELD", "MAINTENANCE", "AVAILABLE"] as const).map((key) => (
              <span key={key}><i className={"cal-dot is-" + STATUS[key].css} />{STATUS[key].label}</span>
            ))}
            <span className="cal-legend-peak"><Zap size={12} aria-hidden="true" /> Peak rate</span>
          </div>

          {loading ? (
            <div className="cal-empty"><CalendarDays size={25}/><strong>Loading availability…</strong></div>
          ) : displayLanes.length === 0 ? (
            <div className="cal-empty"><Grid2X2 size={25}/><strong>No lanes to display</strong><span>Try another lane type or branch.</span></div>
          ) : view === "WEEK" ? (
            <div className="cal-overflow">
              <div className="cal-weekgrid">
                {week.map((day) => {
                  const entries = (daySlots.get(day) ?? []).filter(({ slot }) =>
                    isReservation(slot) && visibleLanes.has(slot.laneId) && matchesStatus(statusFilter, slot))
                    .sort((left, right) => left.start - right.start);
                  return (
                    <button key={day} type="button" className={"cal-weekcard" + (date === day ? " cal-week-selected" : "")}
                      onClick={() => { onDateChange(day); setView("DAY"); }}>
                      <strong>{formatDay(day, { weekday: "short", day: "numeric" })}</strong>
                      <small>{entries.length} {entries.length === 1 ? "booking" : "bookings"}</small>
                      {entries.slice(0, 5).map(({ slot, start }) => (
                        <span className={"cal-weekchip is-" + STATUS[slot.status].css} key={slot.id}>
                          {slotTime(start)} · {slot.booking?.label || STATUS[slot.status].label}
                        </span>
                      ))}
                      {entries.length > 5 && <small>+{entries.length - 5} more</small>}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="cal-overflow cal-day-overflow">
              <div className="cal-grid" style={layout}>
                <div className="cal-lane-heads">
                  <div className="cal-time-head">TIME</div>
                  {displayLanes.map((lane) => (
                    <div key={lane.id} className="cal-lane-head">
                      <span className={"cal-lane-icon " + (lane.type === "BOWLING_MACHINE" ? "cal-machine" : "")}>
                        {lane.type === "TURF_NET" ? <Grid2X2 size={15} aria-hidden="true" /> : <Zap size={15} aria-hidden="true" />}
                      </span>
                      <div><strong>{lane.name}</strong><small>{LANE_LABEL[lane.type]}</small></div>
                    </div>
                  ))}
                </div>
                <div className="cal-timeline" style={{ minHeight: hourCount * HOUR_HEIGHT }}>
                  <div className="cal-ticks">
                    {Array.from({ length: hourCount }, (_, index) => (
                      <span key={index} style={{ top: index * HOUR_HEIGHT + 11 }}>{slotTime(shownStart + index * 60)}</span>
                    ))}
                  </div>
                  {displayLanes.map((lane) => (
                    <div className="cal-track" key={lane.id}>
                      {positionSlots(visibleSlots.filter(({ slot }) => slot.laneId === lane.id))
                        .map(({ slot, start, end, column, columnCount }) => {
                          const height = Math.max((end - start) * HOUR_HEIGHT / 60 - 6, 21);
                          const available = slot.status === "AVAILABLE";
                          const clickable = (available && canBook) || Boolean(slot.booking);
                          const name = slot.booking?.label || STATUS[slot.status].label;
                          const span = slotTime(start) + " – " + slotTime(end);
                          const peak = slot.pricingTiers?.includes("PEAK");
                          const info = (
                            <>
                              <span className="cal-slot-line">
                                {slot.status === "MAINTENANCE" && <Wrench size={12} aria-hidden="true" />}
                                <strong>{name}</strong>
                                {peak && <Zap className="cal-peak" size={12} aria-label="Peak rate" />}
                                {!slot.staffed && slot.status !== "MAINTENANCE" && <AlertTriangle className="cal-unstaffed" size={12} aria-label="No staff coverage" />}
                              </span>
                              {height >= 38 && <small>{span}{available && slot.price !== null ? " · " + money.format(Number(slot.price)) : ""}</small>}
                              {height >= 68 && slot.booking && <small>{STATUS[slot.status].label} · {slot.booking.headcount} players</small>}
                            </>
                          );
                          const props = {
                            className: "cal-slot is-" + STATUS[slot.status].css,
                            style: {
                              top: (start - shownStart) * HOUR_HEIGHT / 60 + 3,
                              height,
                              left: "calc(" + (column / columnCount * 100) + "% + 4px)",
                              width: "calc(" + (100 / columnCount) + "% - 8px)",
                            },
                            title: lane.name + " · " + name + " · " + span,
                          };
                          return clickable ? (
                            <button type="button" key={slot.id} {...props}
                              aria-label={lane.name + ", " + name + ", " + span}
                              onClick={() => onSlotSelect(slot)}>{info}</button>
                          ) : <div key={slot.id} {...props}>{info}</div>;
                        })}
                    </div>
                  ))}
                  {daily.length === 0 && (
                    <div className="cal-overlay-empty"><strong>No slots scheduled</strong><span>Select another date to check availability.</span></div>
                  )}
                  {daily.length > 0 && visibleSlots.length === 0 && (
                    <div className="cal-overlay-empty"><strong>No slots match these filters</strong><button type="button" onClick={() => { setStatusFilter("ALL"); setLaneFilter("ALL"); }}>Clear filters</button></div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        <aside className="cal-rail" aria-label="Booking summary">
          <section className="cal-rail-card" aria-label="Daily snapshot">
            <div className="cal-rail-heading"><h2>Daily snapshot</h2><span>{formatDay(date, { month: "short", day: "numeric" })}</span></div>
            <div className="cal-rail-stat">
              <span className="cal-icon cal-icon-blue"><Grid2X2 size={16}/></span>
              <div><strong>{lanes.length} {lanes.length === 1 ? "lane" : "lanes"}</strong><small>{branchName || "Selected branch"}</small></div>
            </div>
            <div className="cal-rail-stat">
              <span className="cal-icon cal-icon-green"><Check size={16}/></span>
              <div><strong>{confirmed} confirmed</strong><small>{paid} paid · {confirmed - paid} reserved</small></div>
            </div>
            <div className="cal-rail-stat">
              <span className="cal-icon cal-icon-amber"><Clock3 size={16}/></span>
              <div><strong>{pending.length} need attention</strong><small>Holds and payments due</small></div>
            </div>
            <div className="cal-rail-utilization">
              <div><span>Lane utilization</span><strong>{utilization}%</strong></div>
              <progress value={utilization} max={100} aria-label="Lane utilization"/>
            </div>
          </section>

          <section className="cal-rail-card" aria-label="Payment follow-ups">
            <div className="cal-rail-heading"><h2>Payment follow-ups</h2><span className="cal-count">{pending.length} open</span></div>
            {pending.length === 0 && <p className="cal-no-pending">No pending payments.</p>}
            {pending.sort((first, second) => first.start - second.start).slice(0, 3).map(({ slot, start }) => {
              const details = <><span className={"cal-dot is-" + STATUS[slot.status].css} /><span>
                <strong>{slot.booking?.label || lanes.find((lane) => lane.id === slot.laneId)?.name || "Lane booking"}</strong>
                <small>{slotTime(start)} · {slot.status === "HELD" ? "Tentative hold" : "Balance due"}</small>
              </span></>;
              return slot.booking
                ? <button type="button" key={slot.id} className="cal-follow" onClick={() => onSlotSelect(slot)}>{details}</button>
                : <div key={slot.id} className="cal-follow">{details}</div>;
            })}
            {pending.length > 0 && (
              <button type="button" className="cal-link" onClick={() => { setView("DAY"); setStatusFilter("UNPAID"); setLaneFilter("ALL"); }}>
                View payments due <ArrowRight size={14} />
              </button>
            )}
          </section>

          <section className="cal-rail-card cal-roster-card" aria-label="Roster coverage">
            <span className={"cal-icon " + (unstaffed.length ? "cal-icon-amber" : "cal-icon-green")}>
              {unstaffed.length ? <AlertTriangle size={17} /> : <Check size={17} />}
            </span>
            <div><h2>Roster coverage</h2><p>{unstaffed.length
              ? unstaffed.length + (unstaffed.length === 1 ? " slot needs" : " slots need") + " staff coverage."
              : daily.length ? "All scheduled slots are staffed." : "No slots scheduled."}</p></div>
          </section>
        </aside>
      </div>
    </div>
  );
}

