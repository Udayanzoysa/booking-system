import type { Booking, BookingOption } from '../components/BookingDialog';
import type { CalendarLane, CalendarSlot } from '../components/Calendar';
import { shiftDay } from './dates';

export const demoLanes: CalendarLane[] = [
  { id: 'turf-1', name: 'Turf Net 1', type: 'TURF_NET' },
  { id: 'turf-2', name: 'Turf Net 2', type: 'TURF_NET' },
  { id: 'machine-1', name: 'Bowling Machine 1', type: 'BOWLING_MACHINE' },
  { id: 'machine-2', name: 'Bowling Machine 2', type: 'BOWLING_MACHINE' },
];

export const demoCustomers: BookingOption[] = [
  'Colombo Cricket Academy', 'Ravi Fernando', 'Junior Strikers', 'Weekend Warriors',
  'City Smashers', 'Bowling Clinic', 'Chamath Perera', 'Matara Cricket Club',
  'Academy Juniors', 'Dilshan Jay', 'Net Masters', 'Night Practice',
].map((name, index) => ({ id: 'customer-' + index, name }));

export const demoStaff: BookingOption[] = [
  { id: 'staff-1', name: 'Staff Admin' },
  { id: 'staff-2', name: 'Nimal Perera' },
  { id: 'staff-3', name: 'Tharushi Silva' },
];

export const demoPermissions = [
  'MANAGE_TENANT', 'MANAGE_USERS', 'MANAGE_LANES', 'MANAGE_PRICING',
  'VIEW_BOOKINGS', 'MANAGE_BOOKINGS', 'CREATE_UNPAID_HOLD', 'WAIVE_CANCELLATION_FEE',
  'RECORD_PAYMENT', 'ISSUE_REFUND', 'MANAGE_POLICIES', 'MANAGE_ROSTER', 'MANAGE_RBAC',
  'MANAGE_CUSTOMERS', 'VIEW_CUSTOMER_PHONE',
];

const demoBlocks = [
  [[450, 90, 'PAID'], [600, 90, 'PAID'], [775, 70, 'HELD'], [945, 90, 'RESERVED']],
  [[480, 90, 'RESERVED'], [630, 90, 'HELD'], [780, 120, 'PAID']],
  [[540, 120, 'PAID'], [780, 75, 'RESERVED'], [960, 120, 'PAID']],
  [[450, 90, 'PAID'], [720, 60, 'HELD'], [870, 120, 'PAID'], [1050, 90, 'MAINTENANCE']],
] as const;

function slotTime(day: string, minutes: number) {
  return new Date(Date.parse(day + 'T00:00:00+05:30') + minutes * 60000).toISOString();
}

export function demoDay(day: string): CalendarSlot[] {
  return demoLanes.flatMap((lane, index) => {
    const reservations = demoBlocks[index];
    const windows = [
      ...reservations,
      ...Array.from({ length: 16 }, (_, hour) => (hour + 7) * 60)
        .filter((start) => !reservations.some(([from, duration]) => start < from + duration && from < start + 60))
        .map((start) => [start, 60, 'AVAILABLE'] as const),
    ];
    return windows.map(([starts, duration, status]) => ({
      id: [day, lane.id, starts].join('/'),
      laneId: lane.id,
      startsAt: slotTime(day, starts),
      endsAt: slotTime(day, starts + duration),
      status,
      price: status === 'MAINTENANCE' ? null : String(Math.round(duration / 60 * (index < 2 ? 3000 : 5000) + (starts >= 1020 ? 1200 : 0))),
      pricingTiers: [starts >= 1020 ? 'PEAK' : 'OFF_PEAK'],
      staffed: starts < 1080,
    }));
  });
}

export function sampleWeek(start: string, records: Booking[]): CalendarSlot[] {
  const dates = Array.from({ length: 7 }, (_, index) => shiftDay(start, index));
  return dates.flatMap(demoDay).map((slot) => {
    if (slot.status === 'MAINTENANCE') return slot;
    const active = records.find((booking) => booking.slotId === slot.id && ['HELD','CONFIRMED'].includes(booking.status));
    const matching = active ? undefined : records.find((booking) => booking.slotId === slot.id);
    const status = active
      ? active.status === 'HELD' ? 'HELD' : active.paymentStatus === 'FULLY_PAID' ? 'PAID' : 'RESERVED'
      : matching ? 'AVAILABLE' : slot.status;
    return { ...slot, status };
  });
}

export function sampleBookings(slots: CalendarSlot[], now: number): Booking[] {
  let count = 0;
  return slots.filter(({ status }) => ['HELD','PAID','RESERVED'].includes(status)).map((slot) => {
    const person = demoCustomers[count++ % demoCustomers.length];
    const total = slot.price ?? '0';
    const amountPaid = slot.status === 'PAID' ? total : slot.status === 'RESERVED' ? String(Math.round(Number(total) / 3)) : '0';
    return {
      id: 'sample-' + slot.id, slotId: slot.id, slot, customerId: person.id,
      label: person.name, customerName: person.name,
      leadOwnerId: demoStaff[count % demoStaff.length].id, creatorId: demoStaff[0].id,
      headcount: 2 + count % 7, leadSource: (['WEB','WHATSAPP','PHONE','WALK_IN'] as const)[count % 4],
      currency: 'LKR', status: slot.status === 'HELD' ? 'HELD' : 'CONFIRMED',
      paymentStatus: slot.status === 'PAID' ? 'FULLY_PAID' : slot.status === 'RESERVED' ? 'DEPOSIT_PAID' : 'UNPAID',
      totalAmount: total, amountPaid, balanceDue: String(Number(total) - Number(amountPaid)),
      refundableAmount: '0', holdExpiresAt: slot.status === 'HELD' ? new Date(now + 15 * 60000).toISOString() : null,
      unstaffed: !slot.staffed,
    };
  });
}

