"use client";

import { CalendarDays, ChevronRight, ListFilter, Plus, Search } from "lucide-react";
import { useState } from "react";
import { bookingLabel, bookingState, formatBookingDate, formatBookingMoney, formatBookingTime, type Booking, type BookingOption } from "./BookingDialog";
import type { CalendarLane } from "./Calendar";

export type BookingListProps = {
  bookings: Booking[];
  lanes: CalendarLane[];
  timezone: string;
  staff: boolean;
  onSelect: (booking: Booking) => void;
  onCreate?: () => void;
  nextPage?: () => void;
  loading?: boolean;
  customers?: BookingOption[];
  leadOwners?: BookingOption[];
};

type Filter = "all" | "confirmed" | "held" | "past";
type PaymentFilter = "all" | Booking["paymentStatus"];

const paymentLabels: Record<Booking["paymentStatus"], string> = {
  FULLY_PAID: "Fully paid",
  DEPOSIT_PAID: "Deposit paid",
  UNPAID: "Unpaid",
};

export function BookingList({ bookings, lanes, timezone, staff, onSelect, onCreate, nextPage, loading, customers = [], leadOwners = [] }: BookingListProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");
  const [leadOwnerFilter, setLeadOwnerFilter] = useState("");
  const laneNames = new Map(lanes.map(({ id, name }) => [id, name]));
  const leadOwnerNames = new Map(leadOwners.map(({ id, name }) => [id, name]));
  for (const booking of bookings) {
    if (booking.leadOwnerName) leadOwnerNames.set(booking.leadOwnerId, booking.leadOwnerName);
  }
  const leadOwnerOptions = [...leadOwnerNames.entries()].sort(([, a], [, b]) => a.localeCompare(b));
  const query = search.trim().toLowerCase();
  const filtered = Boolean(query || filter !== "all" || paymentFilter !== "all" || leadOwnerFilter);
  const visible = bookings.filter((booking) => {
    if (filter === "confirmed" && booking.status !== "CONFIRMED") return false;
    if (filter === "held" && booking.status !== "HELD") return false;
    if (filter === "past" && !["COMPLETED", "CANCELLED", "EXPIRED"].includes(booking.status)) return false;
    if (paymentFilter !== "all" && booking.paymentStatus !== paymentFilter) return false;
    if (leadOwnerFilter && staff && booking.leadOwnerId !== leadOwnerFilter) return false;
    if (!query) return true;
    const laneName = booking.slot ? (laneNames.get(booking.slot.laneId) ?? "") : "";
    const leadOwner = staff ? (leadOwnerNames.get(booking.leadOwnerId) ?? "") : "";
    return [booking.id, bookingLabel(booking, customers), laneName, bookingState(booking).label, leadOwner]
      .some((entry) => entry.toLowerCase().includes(query));
  }).sort((a, b) => (b.slot?.startsAt ?? "").localeCompare(a.slot?.startsAt ?? ""));

  return <section className="bk-list-page">
    <header className="bk-list-heading">
      <div>
        <h1>{staff ? "Bookings" : "My reservations"}</h1>
        <p>{staff ? "View reservations, payments and guest details." : "Review, reschedule or cancel your bookings."}</p>
      </div>
      {onCreate && <button type="button" className="bk-primary" onClick={onCreate}><Plus size={17} /> {staff ? "New booking" : "Find a slot"}</button>}
    </header>
    <div className="bk-list-card">
      <div className="bk-list-toolbar">
        <label className="bk-list-search"><Search size={17} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={staff ? "Search bookings" : "Search reservations"} aria-label="Search bookings" /></label>
        <label className="bk-list-filter"><ListFilter size={16} /><select value={filter} onChange={(event) => setFilter(event.target.value as Filter)} aria-label="Filter by booking status">
          <option value="all">All statuses</option>
          <option value="confirmed">Reserved or paid</option>
          <option value="held">Tentative holds</option>
          <option value="past">Closed bookings</option>
        </select></label>
        <label className="bk-list-filter"><ListFilter size={16} /><select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value as PaymentFilter)} aria-label="Filter by booking payment status">
          <option value="all">All payment states</option>
          <option value="FULLY_PAID">Fully paid</option>
          <option value="DEPOSIT_PAID">Deposit paid</option>
          <option value="UNPAID">Unpaid</option>
        </select></label>
        {staff && leadOwnerOptions.length > 0 && <label className="bk-list-filter"><ListFilter size={16} /><select value={leadOwnerFilter} onChange={(event) => setLeadOwnerFilter(event.target.value)} aria-label="Filter by lead owner">
          <option value="">All lead owners</option>
          {leadOwnerOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>}
      </div>
      {visible.length > 0 ? <div className="bk-table-scroll">
        <table className="bk-table">
          <thead><tr><th scope="col">{staff ? "Booking" : "Reservation"}</th><th scope="col">Lane and time</th><th scope="col">Status</th><th scope="col">Paid / total</th><th scope="col"><span className="bk-sr-only">Actions</span></th></tr></thead>
          <tbody>{visible.map((booking) => {
            const state = bookingState(booking);
            const title = bookingLabel(booking, customers);
            const lane = booking.slot ? laneNames.get(booking.slot.laneId) : undefined;
            return <tr key={booking.id}>
              <td>
                <strong>{staff ? title : (lane ?? title)}</strong>
                <span>#{booking.id.slice(0, 8).toUpperCase()} · {booking.headcount} {booking.headcount === 1 ? "player" : "players"}</span>
                {staff && <span>Lead owner · {leadOwnerNames.get(booking.leadOwnerId) ?? "Assigned staff"}</span>}
              </td>
              <td>
                {booking.slot ? <>
                  <strong>{staff ? (lane ?? "Scheduled lane") : formatBookingDate(booking.slot.startsAt, timezone)}</strong>
                  <span>{staff ? formatBookingDate(booking.slot.startsAt, timezone) + " · " : ""}{formatBookingTime(booking.slot.startsAt, timezone)}–{formatBookingTime(booking.slot.endsAt, timezone)}</span>
                </> : <span>—</span>}
              </td>
              <td>
                <span className={"bk-state bk-state-" + state.tone}>{state.label}</span>
                {state.label !== "Paid" && <span>{paymentLabels[booking.paymentStatus]}</span>}
              </td>
              <td><strong>{formatBookingMoney(booking.amountPaid, booking.currency)}</strong><span>of {formatBookingMoney(booking.totalAmount, booking.currency)}</span></td>
              <td><button className="bk-row-action" type="button" aria-label={"View booking " + booking.id.slice(0, 8)} onClick={() => onSelect(booking)}>View <ChevronRight size={16} /></button></td>
            </tr>;
          })}</tbody>
        </table>
      </div> : <div className="bk-empty" role="status">
        <CalendarDays size={24} />
        <strong>{loading ? "Loading bookings…" : filtered && nextPage ? "No matches in the loaded bookings" : "No bookings to show"}</strong>
        {!loading && filtered && <button type="button" className="bk-text-action" onClick={() => { setFilter("all"); setPaymentFilter("all"); setLeadOwnerFilter(""); setSearch(""); }}>Clear filters</button>}
      </div>}
      {nextPage && <div className="bk-list-footer">
        <button type="button" className="bk-secondary" onClick={nextPage} disabled={loading}>
          {loading ? "Loading…" : filtered ? "Load more bookings to filter" : "Load more"}
        </button>
      </div>}
    </div>
  </section>;
}

export default BookingList;
