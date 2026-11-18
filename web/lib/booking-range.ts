import type { CalendarSlot } from '../components/Calendar';
import { civilDay } from './dates';

function available(slot: CalendarSlot, now: number) {
  return slot.status === 'AVAILABLE' && slot.kind !== 'MAINTENANCE'
    && Date.parse(slot.startsAt) > now && Date.parse(slot.endsAt) > Date.parse(slot.startsAt)
    && Date.parse(slot.endsAt) - Date.parse(slot.startsAt) <= 86_400_000
    && slot.price !== null && slot.price.trim() !== '' && Number.isFinite(Number(slot.price)) && Number(slot.price) >= 0;
}

/** Available end choices, stopping at the first gap or unavailable session. */
export function contiguousBookingSlots(slots: CalendarSlot[], startId: string, timeZone: string, now: number): CalendarSlot[] {
  const first = slots.find(slot => slot.id === startId);
  if (!first || !available(first, now)) return [];
  const day = civilDay(new Date(first.startsAt), timeZone);
  const ordered = slots.filter(slot => slot.laneId === first.laneId
    && civilDay(new Date(slot.startsAt), timeZone) === day
    && Date.parse(slot.startsAt) >= Date.parse(first.startsAt))
    .sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt) || a.id.localeCompare(b.id));
  const chain: CalendarSlot[] = [first];
  while (chain.length < 48) {
    const endpoint = Date.parse(chain[chain.length - 1].endsAt);
    const next = ordered.find(slot => Date.parse(slot.startsAt) === endpoint && available(slot, now)
      && Date.parse(slot.endsAt) - Date.parse(first.startsAt) <= 86_400_000);
    if (!next) break;
    chain.push(next);
  }
  return chain;
}

/** Revalidate every chosen base slot rather than silently shortening a stale range. */
export function bookingSlotsByIds(slots: CalendarSlot[], ids: readonly string[], timeZone: string, now: number): CalendarSlot[] {
  if (!ids.length || ids.length > 48 || new Set(ids).size !== ids.length) return [];
  const selected = slots.filter(slot => ids.includes(slot.id)).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  if (selected.length !== ids.length) return [];
  const first = selected[0];
  const day = civilDay(new Date(first.startsAt), timeZone);
  return Date.parse(selected[selected.length - 1].endsAt) - Date.parse(first.startsAt) <= 86_400_000
    && selected.every((slot, index) => available(slot, now) && slot.laneId === first.laneId
    && civilDay(new Date(slot.startsAt), timeZone) === day
    && (!index || Date.parse(slot.startsAt) === Date.parse(selected[index - 1].endsAt))) ? selected : [];
}

/** A display-only quote; requests always carry the original selected IDs. */
export function bookingRangeSummary(slots: CalendarSlot[]): CalendarSlot | undefined {
  if (!slots.length) return undefined;
  const price = slots.reduce((total, slot) => total + Math.round(Number(slot.price) * 10_000), 0) / 10_000;
  return { ...slots[0], endsAt: slots[slots.length - 1].endsAt, price: price.toFixed(4), staffed: slots.every(slot => slot.staffed) };
}
