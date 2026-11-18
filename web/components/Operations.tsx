'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CalendarClock, CircleAlert, CircleCheck, Clock3, KeyRound, Pencil, Plus, ShieldCheck, Tag, Trash2, Users, X } from 'lucide-react';
import { createContext, useContext, useState, type FormEvent, type ReactNode } from 'react';
import { api, json } from '../lib/api';
import { civilDay, shiftDay, weekStart } from '../lib/dates';
import { demoCustomers, demoDay, demoLanes, demoStaff } from '../lib/demo';

export type OperationsSection = 'lanes' | 'pricing' | 'roster' | 'customers' | 'access' | 'policies';

interface OperationsProps {
  section: OperationsSection;
  token?: string | null;
  branchId?: string;
  permissions: readonly string[];
  demo?: boolean;
  onChange?: () => void;
  onConnect?: () => void;
}

type Branch = { id: string; name: string; code: string; timeZone: string; isActive: boolean; webLeadOwnerId?: string | null };
type Lane = { id: string; name: string; type: string; isActive: boolean };
type Staff = { id: string; displayName: string; email: string; isActive: boolean };
type Slot = { id: string; laneId: string; status: string; startsAt: string; endsAt: string };
type Shift = { id: string; staffId: string; staff?: Pick<Staff, 'id' | 'displayName'>; startsAt: string; endsAt: string };
type Customer = { id: string; name: string; email: string | null; phone: string | null; walletBalance: string };
type Rate = { dayOfWeek: string; tier: string; startMinute: number; endMinute: number; pricePerHour: string };
type Role = { id: string; name: string; description?: string | null; permissions: { permission: { code: string } }[] };
type Policy = {
  id: string;
  name: string;
  version: number;
  isActive: boolean;
  allowWalletCredit: boolean;
  tiers: { minimumNoticeMinutes: number; feeType: string; feeValue: string | null }[];
};
type Page<T> = { items: T[]; nextCursor: string | null };
type Tenant = { name: string; unpaidHoldMinutes: number; currency: string };

const sections = {
  lanes: { label: 'Arena & ground', description: 'Manage your arena, Full Turf, bookable time, and maintenance.', icon: Building2 },
  pricing: { label: 'Ground pricing', description: 'Set weekly peak and off-peak rates in the branch time zone.', icon: Tag },
  roster: { label: 'Staff roster', description: 'Schedule staff coverage for each branch.', icon: CalendarClock },
  customers: { label: 'Customers', description: 'Find and manage customers for assisted bookings.', icon: Users },
  access: { label: 'Staff & roles', description: 'Create staff accounts and manage what they can access.', icon: ShieldCheck },
  policies: { label: 'Cancellation policies', description: 'Set fees and refund options for future bookings.', icon: Clock3 },
} as const;

const sampleBranch: Branch = { id: 'demo', name: 'Colombo Arena', code: 'CMB', timeZone: 'Asia/Colombo', isActive: true };
const sampleLanes: Lane[] = demoLanes.map((lane) => ({ ...lane, isActive: true }));
const weekdays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

const OpsContext = createContext<OperationsProps | null>(null);

function useOps() {
  const ops = useContext(OpsContext);
  if (!ops) throw new Error('Operations context unavailable');
  return ops;
}

function useAccess(permission: string) {
  const { token, demo, permissions } = useOps();
  return Boolean(token && !demo && permissions.includes(permission));
}

function useResource<T>(path: string | false) {
  const { token, demo } = useOps();
  return useQuery({
    queryKey: ['operations', token, path],
    queryFn: ({ signal }) => api<T>(path as string, token, { signal }),
    enabled: Boolean(path && token && !demo),
    refetchOnWindowFocus: false,
  });
}

function useCommand() {
  const ops = useOps();
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  async function execute(work: () => Promise<unknown>, message = 'Saved') {
    setPending(true);
    setError('');
    setDone('');
    try {
      await work();
      await client.invalidateQueries({ queryKey: ['operations', ops.token] });
      ops.onChange?.();
      setDone(message);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the change.');
      return false;
    } finally {
      setPending(false);
    }
  }

  const request = (path: string, method: string, body?: object) => api(path, ops.token, json(method, body));

  return { pending, error, done, execute, request };
}

function ShellCard({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="ops-card">
      <div className="ops-card-heading"><h2>{title}</h2>{action}</div>
      <div className="ops-card-body">{children}</div>
    </section>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <p className="ops-notice">{children}</p>;
}

function ResourceState({ resource }: { resource: { isLoading: boolean; error: Error | null; refetch: () => unknown } }) {
  if (resource.isLoading) return <p className="ops-notice" role="status">Loading…</p>;
  if (!resource.error) return null;
  return (
    <div className="ops-response ops-error" role="alert">
      <CircleAlert size={16} />
      <span>{resource.error.message}</span>
      <button type="button" className="ops-text-button" onClick={() => void resource.refetch()}>Retry</button>
    </div>
  );
}

function Feedback({ command }: { command: ReturnType<typeof useCommand> }) {
  if (command.error) return <div className="ops-response ops-error" role="alert"><CircleAlert size={16} />{command.error}</div>;
  if (command.done) return <div className="ops-response ops-success" role="status"><CircleCheck size={16} />{command.done}</div>;
  return null;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="ops-field"><span>{label}</span>{children}</label>;
}

function CommandForm({
  children, label, onSubmit, command, reset = false,
}: {
  children: ReactNode;
  label: string;
  onSubmit: (data: FormData) => Promise<unknown>;
  command: ReturnType<typeof useCommand>;
  reset?: boolean;
}) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (await command.execute(() => onSubmit(data))) {
      if (reset) form.reset();
    }
  }

  return (
    <form onSubmit={submit} className="ops-form">
      <fieldset disabled={command.pending}>
        {children}
        <button type="submit" className="ops-button ops-primary">{command.pending ? 'Saving…' : label}</button>
      </fieldset>
      <Feedback command={command} />
    </form>
  );
}

function textField(data: FormData, name: string) {
  return String(data.get(name) ?? '').trim();
}

function branchDateTime(value: string, timeZone: string) {
  const target = Date.parse(value + ':00Z');
  if (!Number.isFinite(target)) throw new Error('Enter a valid date and time.');
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23', timeZone,
  });
  const localValue = (instant: number) => formatter.format(instant).replace(' ', 'T');
  // Include offsets on either side of a daylight-saving change.
  const offsets = [-1, 0, 1].map((day) => {
    const sample = target + day * 86400000;
    return Date.parse(localValue(sample) + ':00Z') - sample;
  });
  const matches = new Set(offsets.map((offset) => target - offset).filter((instant) => localValue(instant) === value));
  if (matches.size !== 1) throw new Error(`Choose a time outside the clock change in ${timeZone}.`);
  return new Date([...matches][0]).toISOString();
}

function rangeQuery(day: string, days: number) {
  // Query around local midnight so the range also covers time-zone offset changes.
  return new URLSearchParams({
    startsAt: shiftDay(day, -1) + 'T00:00:00Z',
    endsAt: shiftDay(day, days + 1) + 'T00:00:00Z',
  }).toString();
}

function inRange(item: { startsAt: string; endsAt: string }, day: string, days: number, timeZone: string) {
  const lastIncluded = new Date(Date.parse(item.endsAt) - 1);
  return civilDay(new Date(item.startsAt), timeZone) < shiftDay(day, days) && civilDay(lastIncluded, timeZone) >= day;
}

function formatRange(startsAt: string, endsAt: string, timeZone: string) {
  const date = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone });
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone });
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const endDay = civilDay(start, timeZone) === civilDay(end, timeZone) ? '' : date.format(end) + ', ';
  return `${date.format(start)}, ${time.format(start)} – ${endDay}${time.format(end)}`;
}

function label(value: string) {
  const known: Record<string, string> = {
    TURF_NET: 'Indoor Ground',
    BOWLING_MACHINE: 'Indoor Ground',
    OFF_PEAK: 'Off-peak',
    UNPRICED: 'Rate needed',
    HELD: 'Tentative hold',
    BOOKABLE: 'Bookable',
  };
  return known[value] ?? value.toLowerCase().replaceAll('_', ' ').replace(/^./, (first) => first.toUpperCase());
}

function Pill({ children, tone = 'blue' }: { children: ReactNode; tone?: 'blue' | 'green' | 'grey' | 'amber' }) {
  return <span className={`ops-pill ops-pill-${tone}`}>{children}</span>;
}

function StaffField({ staff, name, value, labelText, required = false }: { staff: Staff[]; name: string; value?: string | null; labelText: string; required?: boolean }) {
  const active = staff.filter(({ isActive }) => isActive);
  return (
    <Field label={labelText}>
      {active.length > 0 ? (
        <select name={name} defaultValue={value ?? ''} required={required}>
          <option value="">{required ? 'Select staff member' : 'Unassigned'}</option>
          {value && !active.some(({ id }) => id === value) && <option value={value}>{value}</option>}
          {active.map(({ id, displayName }) => <option key={id} value={id}>{displayName}</option>)}
        </select>
      ) : <input name={name} defaultValue={value ?? ''} placeholder="Staff account ID" required={required} />}
    </Field>
  );
}

function BranchForm({ branch, staff }: { branch?: Branch; staff: Staff[] }) {
  const command = useCommand();
  return (
    <CommandForm label={branch ? 'Save branch' : 'Create branch'} command={command} reset={!branch} onSubmit={(data) => {
      const fields = { name: textField(data, 'name'), timeZone: textField(data, 'timeZone'), webLeadOwnerId: textField(data, 'webLeadOwnerId') || null };
      return branch
        ? command.request(`/branches/${branch.id}`, 'PATCH', { ...fields, isActive: data.has('isActive') })
        : command.request('/branches', 'POST', { ...fields, code: textField(data, 'code') });
    }}>
      <Field label="Branch name"><input name="name" defaultValue={branch?.name} required maxLength={120} /></Field>
      {!branch && <Field label="Branch code"><input name="code" placeholder="CMB" pattern="[a-zA-Z0-9_\-]+" required maxLength={40} /></Field>}
      <Field label="Time zone"><input name="timeZone" defaultValue={branch?.timeZone ?? 'Asia/Colombo'} required maxLength={120} /></Field>
      <StaffField staff={staff} name="webLeadOwnerId" value={branch?.webLeadOwnerId} labelText="Web booking lead owner" />
      {branch && <label className="ops-check"><input name="isActive" type="checkbox" defaultChecked={branch.isActive} /> Active branch</label>}
    </CommandForm>
  );
}

function LaneForm({ branchId, lane }: { branchId: string; lane?: Lane }) {
  const command = useCommand();
  return (
    <CommandForm label={lane ? 'Save ground' : 'Add ground'} command={command} reset={!lane} onSubmit={(data) => lane
      ? command.request(`/lanes/${lane.id}`, 'PATCH', { name: textField(data, 'name'), isActive: data.has('isActive') })
      : command.request('/lanes', 'POST', { branchId, name: textField(data, 'name'), type: 'TURF_NET' })}>
      <Field label="Ground name"><input name="name" defaultValue={lane?.name ?? 'Full Turf'} placeholder="Full Turf" required maxLength={120} /></Field>
      {lane && <label className="ops-check"><input name="isActive" type="checkbox" defaultChecked={lane.isActive} /> Active ground</label>}
    </CommandForm>
  );
}

function SlotSchedule({ branch, lanes }: { branch: Branch; lanes: Lane[] }) {
  const { demo } = useOps();
  const command = useCommand();
  const [day, setDay] = useState(() => civilDay(new Date(), branch.timeZone));
  const canManage = useAccess('MANAGE_LANES');
  const active = branch.isActive && lanes.some(({ isActive }) => isActive);
  const availability = useResource<{ slots: Slot[] }>(active && `/branches/${branch.id}/availability?${rangeQuery(day, 1)}`);
  const slots = demo ? demoDay(day) : (availability.data?.slots ?? []).filter((slot) => inRange(slot, day, 1, branch.timeZone));

  return (
    <div className="ops-layout">
      <ShellCard title="Scheduled slots" action={<input aria-label="Scheduled slot date" value={day} type="date" onChange={(event) => event.target.value && setDay(event.target.value)} />}>
        <ResourceState resource={availability} />
        <Feedback command={command} />
        {slots.length > 0 ? (
          <div className="ops-table-scroll ops-slot-scroll"><table><thead><tr><th>Ground</th><th>Time</th><th>Status</th>{canManage && <th><span className="ops-sr-only">Actions</span></th>}</tr></thead>
            <tbody>{slots.map((slot) => (
              <tr key={slot.id}>
                <td>{lanes.find(({ id }) => id === slot.laneId)?.name ?? 'Full Turf'}</td>
                <td>{formatRange(slot.startsAt, slot.endsAt, branch.timeZone)}</td>
                <td><Pill tone={slot.status === 'AVAILABLE' ? 'green' : slot.status === 'MAINTENANCE' ? 'grey' : 'amber'}>{label(slot.status)}</Pill></td>
                {canManage && <td><button className="ops-icon-button ops-danger" type="button" aria-label="Remove scheduled slot" disabled={command.pending} onClick={() => {
                  if (window.confirm('Remove this scheduled slot?')) void command.execute(() => command.request(`/lanes/${slot.laneId}/slots/${slot.id}`, 'DELETE'), 'Slot removed');
                }}><Trash2 size={16} /></button></td>}
              </tr>
            ))}</tbody>
          </table></div>
        ) : !availability.isLoading && !availability.error && <Notice>No slots scheduled for this day.</Notice>}
      </ShellCard>
      {canManage && active && <ShellCard title="Add scheduled slot">
        <SlotForm branch={branch} lanes={lanes.filter(({ isActive }) => isActive)} />
      </ShellCard>}
    </div>
  );
}

function SlotForm({ branch, lanes }: { branch: Branch; lanes: Lane[] }) {
  const command = useCommand();
  return (
    <CommandForm command={command} label="Add slot" reset onSubmit={(data) => command.request(`/lanes/${textField(data, 'lane')}/slots`, 'POST', {
      startsAt: branchDateTime(textField(data, 'startsAt'), branch.timeZone),
      endsAt: branchDateTime(textField(data, 'endsAt'), branch.timeZone),
      kind: textField(data, 'kind'),
    })}>
      {lanes.length === 1 ? <><input type="hidden" name="lane" value={lanes[0].id}/><p className="ops-notice">Indoor Ground · {lanes[0].name}</p></> : <Field label="Ground"><select name="lane" required>{lanes.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}</select></Field>}
      <Field label="Slot type"><select name="kind"><option value="BOOKABLE">Bookable</option><option value="MAINTENANCE">Maintenance</option></select></Field>
      <Field label="Starts"><input name="startsAt" type="datetime-local" required /></Field>
      <Field label="Ends"><input name="endsAt" type="datetime-local" required /></Field>
      <p className="ops-subtle">Times use {branch.timeZone}.</p>
    </CommandForm>
  );
}

function Venues({ branch, branches, staff, lanes }: { branch?: Branch; branches: Branch[]; staff: Staff[]; lanes: Lane[] }) {
  const canEditBranch = useAccess('MANAGE_TENANT');
  const canEditLane = useAccess('MANAGE_LANES');
  const [selectedBranch, setSelectedBranch] = useState<string>();
  const [selectedLane, setSelectedLane] = useState<string>();
  const editingBranch = branches.find(({ id }) => id === selectedBranch);
  const editingLane = lanes.find(({ id }) => id === selectedLane);
  return (
    <div className="ops-stack">
      <div className="ops-layout">
        <ShellCard title="Branches">
          {branches.length ? branches.map((item) => (
            <div key={item.id} className="ops-list-row">
              <div className="ops-row-icon"><Building2 size={17} /></div>
              <div className="ops-row-main"><strong>{item.name}</strong><span>{item.code} · {item.timeZone}</span></div>
              <Pill tone={item.isActive ? 'green' : 'grey'}>{item.isActive ? 'Active' : 'Inactive'}</Pill>
              {canEditBranch && <button type="button" className="ops-icon-button" aria-label={`Edit ${item.name}`} onClick={() => setSelectedBranch(item.id)}><Pencil size={15} /></button>}
            </div>
          )) : <Notice>Create your arena to start scheduling Full Turf.</Notice>}
        </ShellCard>
        {canEditBranch && <ShellCard title={editingBranch ? 'Edit branch' : 'New branch'} action={editingBranch && (
          <button type="button" className="ops-text-button" onClick={() => setSelectedBranch(undefined)}><Plus size={15} /> New branch</button>
        )}><BranchForm key={editingBranch?.id ?? 'new'} branch={editingBranch} staff={staff} /></ShellCard>}
      </div>
      {branch && <>
        <div className="ops-layout">
          <ShellCard title={`Indoor ground · ${branch.name}`}>
            {lanes.length ? lanes.map((lane) => (
              <div key={lane.id} className="ops-list-row">
                <div className="ops-row-main"><strong>{lane.name}</strong><span>{label(lane.type)}</span></div>
                <Pill tone={lane.isActive ? 'green' : 'grey'}>{lane.isActive ? 'Active' : 'Inactive'}</Pill>
                {canEditLane && <button type="button" className="ops-icon-button" aria-label={`Edit ${lane.name}`} onClick={() => setSelectedLane(lane.id)}><Pencil size={15} /></button>}
              </div>
            )) : <Notice>No indoor ground at this arena yet.</Notice>}
          </ShellCard>
          {canEditLane && (branch.isActive || editingLane) && <ShellCard title={editingLane ? 'Edit ground' : 'New ground'} action={editingLane && (
            <button type="button" className="ops-text-button" onClick={() => setSelectedLane(undefined)}><Plus size={15} /> New ground</button>
          )}><LaneForm key={editingLane?.id ?? 'new'} branchId={branch.id} lane={editingLane} /></ShellCard>}
        </div>
        <SlotSchedule branch={branch} lanes={lanes} />
      </>}
      {canEditBranch && <TenantSettings />}
    </div>
  );
}

function TenantSettings() {
  const tenant = useResource<Tenant>('/tenants/current');
  const command = useCommand();
  return (
    <ShellCard title="Arena settings">
      <ResourceState resource={tenant} />
      {tenant.data && <CommandForm label="Save arena settings" command={command} onSubmit={(data) => command.request('/tenants/current', 'PATCH', {
        name: textField(data, 'name'), unpaidHoldMinutes: Number(data.get('duration')),
      })}>
        <div className="ops-fields">
          <Field label="Arena name"><input name="name" defaultValue={tenant.data.name} required maxLength={120} /></Field>
          <Field label="Unpaid hold duration in minutes"><input name="duration" type="number" min="1" max="2147483647" step="1" defaultValue={tenant.data.unpaidHoldMinutes} required /></Field>
        </div>
      </CommandForm>}
    </ShellCard>
  );
}

function minuteLabel(minute: number) {
  const hour = Math.floor(minute / 60);
  return `${String(hour).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function TimeFields({ rate, update }: { rate: Rate; update: (change: Partial<Rate>) => void }) {
  const minuteValue = (value: string) => value.split(':').reduce((total, part) => total * 60 + Number(part), 0);
  return <>
    <input aria-label="Window start" type="time" required value={minuteLabel(rate.startMinute)} onChange={(event) => update({ startMinute: minuteValue(event.target.value) })} />
    <div className="ops-end-time">
      <input aria-label="Window end" type="time" required disabled={rate.endMinute === 1440} value={minuteLabel(rate.endMinute % 1440)} onChange={(event) => update({ endMinute: minuteValue(event.target.value) })} />
      <label className="ops-check"><input type="checkbox" checked={rate.endMinute === 1440} onChange={(event) => update({ endMinute: event.target.checked ? 1440 : 1380 })} /> Ends at midnight</label>
    </div>
  </>;
}

function RatesEditor({ rates, laneId }: { rates: Rate[]; laneId: string }) {
  const command = useCommand();
  const [draft, setDraft] = useState(rates);
  function update(index: number, change: Partial<Rate>) {
    setDraft((current) => current.map((rate, row) => row === index ? { ...rate, ...change } : rate));
  }
  return (
    <CommandForm command={command} label="Save ground rates" onSubmit={() => {
      if (!draft.length) throw new Error('Add at least one pricing window.');
      return command.request(`/lanes/${laneId}/pricing`, 'PUT', {
        rules: draft.map(({ dayOfWeek, tier, startMinute, endMinute, pricePerHour }) => ({ dayOfWeek, tier, startMinute, endMinute, pricePerHour })),
      });
    }}>
      <div className="ops-table-scroll ops-rate-scroll">
        <div className="ops-rate-head"><span>Day</span><span>Tier</span><span>Starts</span><span>Ends</span><span>Hourly rate</span><span /></div>
        {draft.map((rate, index) => (
          <div className="ops-rate-row" key={index}>
            <select aria-label="Day of week" value={rate.dayOfWeek} onChange={(event) => update(index, { dayOfWeek: event.target.value })}>
              {weekdays.map((day) => <option key={day} value={day}>{label(day)}</option>)}
            </select>
            <select aria-label="Rate tier" value={rate.tier} onChange={(event) => update(index, { tier: event.target.value })}><option value="OFF_PEAK">Off-peak</option><option value="PEAK">Peak</option></select>
            <TimeFields rate={rate} update={(change) => update(index, change)} />
            <input aria-label="Hourly rate" required type="number" min="0" max="9999999" step="0.0001" value={rate.pricePerHour} onChange={(event) => update(index, { pricePerHour: event.target.value })} />
            <button type="button" className="ops-icon-button" aria-label="Remove pricing window" onClick={() => setDraft(draft.filter((_, row) => row !== index))}><X size={17} /></button>
          </div>
        ))}
      </div>
      <button type="button" className="ops-button" onClick={() => setDraft([...draft, { dayOfWeek: 'MONDAY', tier: 'OFF_PEAK', startMinute: 360, endMinute: 1020, pricePerHour: '' }])}>
        <Plus size={16} /> Add rate window
      </button>
    </CommandForm>
  );
}

function Pricing({ lanes }: { lanes: Lane[] }) {
  const { demo } = useOps();
  const canEdit = useAccess('MANAGE_PRICING');
  const [selected, setSelected] = useState('');
  const laneId = selected || lanes[0]?.id;
  const pricing = useResource<Rate[]>(Boolean(laneId && canEdit) && `/lanes/${laneId}/pricing`);
  const base = lanes.find(({ id }) => id === laneId)?.type === 'BOWLING_MACHINE' ? 5000 : 3000;
  const sampleRates: Rate[] = demo ? weekdays.flatMap((dayOfWeek) => [
    { dayOfWeek, tier: 'OFF_PEAK', startMinute: 420, endMinute: 1020, pricePerHour: String(base) },
    { dayOfWeek, tier: 'PEAK', startMinute: 1020, endMinute: 1380, pricePerHour: String(base + 1200) },
  ]) : [];
  return (
    <ShellCard title="Weekly rate schedule" action={lanes.length > 0 && (
      <select aria-label="Pricing ground" value={laneId} onChange={(event) => setSelected(event.target.value)}>
        {lanes.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
      </select>
    )}>
      {demo ? <div className="ops-table-scroll"><table><thead><tr><th>Day</th><th>Tier</th><th>Time window</th><th>Hourly rate</th></tr></thead><tbody>
        {sampleRates.map((rate) => <tr key={rate.dayOfWeek + rate.tier}><td>{label(rate.dayOfWeek)}</td><td><Pill tone={rate.tier === 'PEAK' ? 'amber' : 'blue'}>{label(rate.tier)}</Pill></td><td>{minuteLabel(rate.startMinute)} – {minuteLabel(rate.endMinute)}</td><td>LKR {Number(rate.pricePerHour).toLocaleString('en-LK')}</td></tr>)}
      </tbody></table></div> : <>
        <ResourceState resource={pricing} />
        {!canEdit && <Notice>You need pricing access to view and edit rate schedules.</Notice>}
        {canEdit && !laneId && <Notice>Add Full Turf before configuring pricing.</Notice>}
        {pricing.data && laneId && <RatesEditor key={laneId} rates={pricing.data} laneId={laneId} />}
      </>}
    </ShellCard>
  );
}

function Roster({ branch, staff }: { branch: Branch; staff: Staff[] }) {
  const { demo } = useOps();
  const canEdit = useAccess('MANAGE_ROSTER');
  const command = useCommand();
  const [day, setDay] = useState(() => weekStart(civilDay(new Date(), branch.timeZone)));
  const shifts = useResource<Shift[]>(canEdit && `/branches/${branch.id}/roster?${rangeQuery(day, 7)}`);
  const scheduled = (shifts.data ?? []).filter((shift) => inRange(shift, day, 7, branch.timeZone));
  return (
    <div className="ops-layout">
      <ShellCard title={`Weekly coverage · ${branch.name}`} action={<input aria-label="Week starting" type="date" value={day} onChange={(event) => event.target.value && setDay(event.target.value)} />}>
        <ResourceState resource={shifts} />
        <Feedback command={command} />
        {demo && demoStaff.slice(1).map(({ name }, index) => <div className="ops-list-row" key={name}><div className="ops-row-main"><strong>{name}</strong><span>{index ? '14:00 – 22:00' : '06:00 – 14:00'}</span></div><Pill tone="green">Scheduled</Pill></div>)}
        {!demo && (scheduled.length ? scheduled.map((shift) => (
          <div key={shift.id} className="ops-list-row">
            <div className="ops-row-main"><strong>{shift.staff?.displayName ?? 'Staff member'}</strong><span>{formatRange(shift.startsAt, shift.endsAt, branch.timeZone)}</span></div>
            <button type="button" className="ops-icon-button ops-danger" aria-label="Remove shift" disabled={command.pending} onClick={() => {
              if (window.confirm('Remove this staff shift?')) void command.execute(() => command.request(`/branches/${branch.id}/roster/${shift.id}`, 'DELETE'), 'Shift removed');
            }}><Trash2 size={16} /></button>
          </div>
        )) : !shifts.isLoading && !shifts.error && <Notice>{canEdit ? 'No shifts scheduled for this week.' : 'You need roster access to view shifts.'}</Notice>)}
      </ShellCard>
      {canEdit && <ShellCard title="Schedule a shift"><ShiftForm branch={branch} staff={staff} /></ShellCard>}
    </div>
  );
}

function ShiftForm({ branch, staff }: { branch: Branch; staff: Staff[] }) {
  const command = useCommand();
  return (
    <CommandForm command={command} label="Add shift" reset onSubmit={(data) => command.request(`/branches/${branch.id}/roster`, 'POST', {
      staffId: textField(data, 'staff'), startsAt: branchDateTime(textField(data, 'startsAt'), branch.timeZone), endsAt: branchDateTime(textField(data, 'endsAt'), branch.timeZone),
    })}>
      <StaffField labelText="Staff member" name="staff" staff={staff} required />
      <Field label="Starts"><input name="startsAt" type="datetime-local" required /></Field>
      <Field label="Ends"><input name="endsAt" type="datetime-local" required /></Field>
      <p className="ops-subtle">Times use {branch.timeZone}.</p>
    </CommandForm>
  );
}

const sampleCustomers: Customer[] = demoCustomers.map(({ id, name }, index) => ({
  id, name, email: null, phone: index < 3 ? `••••${3321 + index * 170}` : null,
  walletBalance: index === 1 ? '1500' : '0',
}));

function Customers() {
  const { demo, token } = useOps();
  const canEdit = useAccess('MANAGE_CUSTOMERS');
  const canReveal = useAccess('VIEW_CUSTOMER_PHONE');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string>();
  const [revealed, setRevealed] = useState<{ id: string; phone: string | null }>();
  const [pendingPhone, setPendingPhone] = useState<string>();
  const [phoneError, setPhoneError] = useState('');
  const [pages, setPages] = useState<string[]>([]);
  const cursor = pages.at(-1);
  const customers = useResource<{ customers: Customer[]; nextCursor: string | null }>(canEdit && ('/customers' + (cursor ? `?after=${cursor}` : '')));
  const tenant = useResource<Tenant>(canEdit && '/tenants/current');
  const currency = demo ? 'LKR' : tenant.data?.currency;
  const rows = demo ? sampleCustomers : customers.data?.customers ?? [];
  const query = filter.trim().toLowerCase();
  const visible = rows.filter((row) => row.name.toLowerCase().includes(query) || row.email?.toLowerCase().includes(query) || row.phone?.includes(query));
  const editing = rows.find(({ id }) => id === selected);

  async function reveal(id: string) {
    setPhoneError('');
    if (revealed?.id === id) { setRevealed(undefined); return; }
    setRevealed(undefined);
    setPendingPhone(id);
    try {
      setRevealed(await api<{ id: string; phone: string | null }>(`/customers/${id}/phone`, token));
    } catch (error) {
      setPhoneError(error instanceof Error ? error.message : 'Could not load the phone number.');
    } finally {
      setPendingPhone(undefined);
    }
  }

  return (
    <div className="ops-layout">
      <ShellCard title="Customer directory" action={<input aria-label="Filter this page" placeholder="Search this page" value={filter} onChange={(event) => setFilter(event.target.value)} />}>
        <ResourceState resource={customers} />
        {phoneError && <p className="ops-response ops-error" role="alert">{phoneError}</p>}
        {visible.length ? <div className="ops-table-scroll"><table><thead><tr><th>Customer</th><th>Phone</th><th>Wallet balance</th>{canEdit && <th><span className="ops-sr-only">Actions</span></th>}</tr></thead>
          <tbody>{visible.map((row) => (
            <tr key={row.id}>
              <td><strong>{row.name}</strong>{row.email && <small>{row.email}</small>}</td>
              <td>{(canReveal && revealed?.id === row.id ? revealed.phone : row.phone) || '—'} {canReveal && row.phone && (
                <button className="ops-text-button" type="button" disabled={Boolean(pendingPhone)} onClick={() => void reveal(row.id)}>{pendingPhone === row.id ? 'Loading…' : revealed?.id === row.id ? 'Hide' : 'Reveal'}</button>
              )}</td>
              <td>{currency && currency + ' '}{Number(row.walletBalance).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
              {canEdit && <td><button type="button" className="ops-icon-button" aria-label={`Edit ${row.name}`} onClick={() => setSelected(row.id)}><Pencil size={15} /></button></td>}
            </tr>
          ))}</tbody></table></div> : !customers.isLoading && !customers.error && <Notice>{canEdit || demo ? 'No customers match this page.' : 'You need customer access to view the directory.'}</Notice>}
        {(pages.length > 0 || customers.data?.nextCursor) && <div className="ops-inline">
          <button type="button" className="ops-button" disabled={!pages.length} onClick={() => setPages(pages.slice(0, -1))}>Previous</button>
          <button type="button" className="ops-button" disabled={!customers.data?.nextCursor} onClick={() => {
            if (customers.data?.nextCursor) setPages([...pages, customers.data.nextCursor]);
          }}>Next</button>
        </div>}
      </ShellCard>
      {canEdit && <ShellCard title={editing ? 'Edit customer' : 'New customer'} action={editing && (
        <button type="button" className="ops-text-button" onClick={() => setSelected(undefined)}><Plus size={15} /> New customer</button>
      )}><CustomerForm key={editing?.id ?? 'new'} customer={editing} /></ShellCard>}
    </div>
  );
}

function CustomerForm({ customer }: { customer?: Customer }) {
  const command = useCommand();
  return (
    <CommandForm command={command} label={customer ? 'Save customer' : 'Create customer'} reset={!customer} onSubmit={(data) => {
      const phone = textField(data, 'phone');
      const fields = {
        name: textField(data, 'name'),
        email: textField(data, 'email') || null,
        phone: phone || (data.has('clearPhone') ? null : undefined),
      };
      return customer ? command.request(`/customers/${customer.id}`, 'PATCH', fields) : command.request('/customers', 'POST', fields);
    }}>
      <Field label="Name"><input name="name" defaultValue={customer?.name} required maxLength={120} /></Field>
      <Field label="Email"><input name="email" type="email" defaultValue={customer?.email ?? ''} maxLength={254} /></Field>
      <Field label={customer ? 'Replacement phone' : 'Phone'}><input name="phone" type="tel" placeholder="+94771234567" pattern="\+[1-9][0-9]{6,14}" /></Field>
      {customer?.phone && <label className="ops-check"><input type="checkbox" name="clearPhone" /> Remove saved phone number</label>}
    </CommandForm>
  );
}

const samplePolicy: Policy = {
  id: 'standard', name: 'Standard cancellation', version: 1, isActive: true, allowWalletCredit: true,
  tiers: [
    { minimumNoticeMinutes: 0, feeType: 'FORFEIT_PAID_AMOUNT', feeValue: null },
    { minimumNoticeMinutes: 360, feeType: 'PERCENT_OF_BOOKING_TOTAL', feeValue: '25' },
    { minimumNoticeMinutes: 1440, feeType: 'FREE', feeValue: null },
  ],
};

function policyFee(tier: Policy['tiers'][number]) {
  if (tier.feeType === 'FREE') return 'No fee';
  if (tier.feeType === 'FORFEIT_PAID_AMOUNT') return 'Paid amount forfeited';
  return tier.feeType === 'FIXED' ? tier.feeValue : `${tier.feeValue}% of booking total`;
}

function Policies() {
  const { demo } = useOps();
  const canEdit = useAccess('MANAGE_POLICIES');
  const policies = useResource<Policy[]>('/cancellation-policies');
  const list = demo ? [samplePolicy] : policies.data ?? [];
  return (
    <div className="ops-layout">
      <ShellCard title="Published policies">
        <ResourceState resource={policies} />
        {list.length ? list.map((policy) => (
          <div className="ops-policy" key={policy.id}>
            <div className="ops-list-row"><div className="ops-row-main"><strong>{policy.name}</strong><span>Version {policy.version}{policy.allowWalletCredit ? ' · Wallet refunds available' : ''}</span></div><Pill tone={policy.isActive ? 'green' : 'grey'}>{policy.isActive ? 'Active' : 'Archived'}</Pill></div>
            <dl>{[...policy.tiers].reverse().map((tier) => <div key={tier.minimumNoticeMinutes}><dt>{tier.minimumNoticeMinutes === 0 ? 'Under 6 hours' : tier.minimumNoticeMinutes === 360 ? '6 to 24 hours' : 'Over 24 hours'}</dt><dd>{policyFee(tier)}</dd></div>)}</dl>
          </div>
        )) : !policies.isLoading && !policies.error && <Notice>No cancellation policies published.</Notice>}
      </ShellCard>
      {canEdit && <ShellCard title="Publish a policy"><PolicyForm /></ShellCard>}
    </div>
  );
}

function PolicyForm() {
  const command = useCommand();
  const [type, setType] = useState('PERCENT_OF_BOOKING_TOTAL');
  return (
    <CommandForm command={command} label="Publish policy" onSubmit={(data) => command.request('/cancellation-policies', 'POST', {
      name: textField(data, 'name'), partialFeeType: type, partialFeeValue: textField(data, 'value'), allowWalletCredit: data.has('credit'),
    })}>
      <Field label="Policy name"><input name="name" placeholder="Standard cancellation" required maxLength={120} /></Field>
      <Field label="Fee for 6 to 24 hours"><select value={type} onChange={(event) => setType(event.target.value)}><option value="PERCENT_OF_BOOKING_TOTAL">Percentage of booking total</option><option value="FIXED">Fixed amount</option></select></Field>
      <Field label={type === 'FIXED' ? 'Amount in venue currency' : 'Percentage'}><input type="number" name="value" required min="0.0001" max={type === 'FIXED' ? '9999999999' : '99.9999'} step="0.0001" /></Field>
      <label className="ops-check"><input type="checkbox" name="credit" /> Allow refunds to the customer wallet</label>
      <p className="ops-subtle">Publishing under an existing name creates a new version.</p>
    </CommandForm>
  );
}

function Access({ staff }: { staff: Staff[] }) {
  const { demo } = useOps();
  const canUsers = useAccess('MANAGE_USERS');
  const canRoles = useAccess('MANAGE_RBAC');
  const roles = useResource<Role[]>(canRoles && '/rbac/roles');
  const codes = useResource<string[]>(canRoles && '/rbac/permissions');
  const [editing, setEditing] = useState<string>();
  const selected = roles.data?.find(({ id }) => id === editing);
  return (
    <div className="ops-stack">
      <div className="ops-layout">
        <ShellCard title="Staff accounts">
          {(demo ? [{ id: 'staff', displayName: 'Nimal Perera', email: 'Staff administrator', isActive: true }] : staff).map((user) => (
            <div className="ops-list-row" key={user.id}><div className="ops-row-icon"><Users size={16} /></div><div className="ops-row-main"><strong>{user.displayName}</strong><span>{user.email}</span></div><Pill tone={user.isActive ? 'green' : 'grey'}>{user.isActive ? 'Active' : 'Inactive'}</Pill></div>
          ))}
          {!demo && !staff.length && <Notice>{canUsers ? 'No staff accounts found.' : 'You need staff account access to list accounts.'}</Notice>}
        </ShellCard>
        {canUsers && <ShellCard title="Add staff account"><StaffForm /></ShellCard>}
      </div>
      <div className="ops-layout">
        <ShellCard title="Permission roles">
          <ResourceState resource={roles} />
          {(demo ? ['Administrator', 'Booking staff', 'Web Customer'] : []).map((role) => <div key={role} className="ops-list-row"><div className="ops-row-icon"><ShieldCheck size={16} /></div><strong>{role}</strong></div>)}
          {roles.data?.map((role) => (
            <div className="ops-list-row" key={role.id}>
              <div className="ops-row-icon"><ShieldCheck size={16} /></div>
              <div className="ops-row-main"><strong>{role.name}</strong><span>{role.description ?? `${role.permissions.length} permissions`}</span></div>
              {role.name !== 'Web Customer' && <button type="button" className="ops-icon-button" aria-label={`Edit ${role.name} permissions`} onClick={() => setEditing(role.id)}><Pencil size={15} /></button>}
            </div>
          ))}
          {!demo && !canRoles && <Notice>You need role management access to view roles.</Notice>}
          {canRoles && roles.data && !roles.data.length && <Notice>No roles configured.</Notice>}
        </ShellCard>
        {canRoles && <ShellCard title={selected ? 'Edit role permissions' : 'New role'} action={selected && <button className="ops-text-button" type="button" onClick={() => setEditing(undefined)}><Plus size={15} /> New role</button>}>
          <ResourceState resource={codes} />
          {codes.data && <RoleForm key={selected?.id ?? 'new'} role={selected} codes={codes.data} />}
        </ShellCard>}
      </div>
      {canRoles && roles.data && roles.data.length > 0 && <ShellCard title="Staff role assignments"><AssignmentForm roles={roles.data} staff={staff} /></ShellCard>}
    </div>
  );
}

function StaffForm() {
  const command = useCommand();
  return (
    <CommandForm command={command} label="Create staff account" reset onSubmit={(data) => command.request('/users', 'POST', {
      displayName: textField(data, 'displayName'), email: textField(data, 'email'), password: data.get('password'),
    })}>
      <Field label="Name"><input name="displayName" required maxLength={120} /></Field>
      <Field label="Email"><input name="email" type="email" required maxLength={254} /></Field>
      <Field label="Password"><input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></Field>
    </CommandForm>
  );
}

function RoleForm({ role, codes }: { role?: Role; codes: string[] }) {
  const command = useCommand();
  return (
    <CommandForm command={command} label={role ? 'Save permissions' : 'Create role'} reset={!role} onSubmit={(data) => {
      const permissionCodes = data.getAll('permission');
      return role ? command.request(`/rbac/roles/${role.id}/permissions`, 'PUT', { permissionCodes }) : command.request('/rbac/roles', 'POST', {
        name: textField(data, 'name'), description: textField(data, 'description') || undefined, permissionCodes,
      });
    }}>
      {role ? <p className="ops-subtle">{role.name}</p> : <><Field label="Role name"><input name="name" required maxLength={80} /></Field><Field label="Description"><input name="description" maxLength={300} /></Field></>}
      <div className="ops-permissions" aria-label="Permissions">
        {codes.map((code) => <label key={code} className="ops-check"><input type="checkbox" name="permission" value={code} defaultChecked={role?.permissions.some(({ permission }) => permission.code === code)} /> {label(code)}</label>)}
      </div>
    </CommandForm>
  );
}

function AssignmentForm({ roles, staff }: { roles: Role[]; staff: Staff[] }) {
  const command = useCommand();
  return (
    <CommandForm command={command} label="Save assignment" onSubmit={(data) => command.request(
      `/rbac/users/${textField(data, 'userId')}/roles/${textField(data, 'roleId')}`, textField(data, 'action'),
    )}>
      <div className="ops-fields">
        <StaffField staff={staff} name="userId" labelText="Staff account" required />
        <Field label="Role"><select name="roleId" required>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></Field>
        <Field label="Action"><select name="action"><option value="PUT">Grant role</option><option value="DELETE">Revoke role</option></select></Field>
      </div>
    </CommandForm>
  );
}

function OperationsView() {
  const ops = useOps();
  const { section, demo, onConnect } = ops;
  const canUsers = useAccess('MANAGE_USERS');
  const isBranchSection = ['lanes', 'pricing', 'roster'].includes(section);
  const branchesQuery = useResource<Branch[]>(isBranchSection && '/branches');
  const branches = demo ? [sampleBranch] : branchesQuery.data ?? [];
  const branch = branches.find(({ id }) => id === ops.branchId) ?? branches.find(({ isActive }) => isActive) ?? branches[0];
  const staff = useQuery({
    queryKey: ['operations', ops.token, 'staff'],
    enabled: canUsers && ['lanes', 'roster', 'access'].includes(section),
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const items: Staff[] = [];
      let cursor: string | null = null;
      do {
        const query = new URLSearchParams({ limit: '100' });
        if (cursor) query.set('cursor', cursor);
        const page: Page<Staff> = await api('/users?' + query, ops.token, { signal });
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      return items;
    },
  });
  const lanes = useResource<Lane[]>(Boolean(branch && ['lanes', 'pricing'].includes(section)) && `/branches/${branch?.id}/lanes`);
  const laneList = demo ? sampleLanes : lanes.data ?? [];
  const staffList = staff.data ?? [];
  const PageIcon = sections[section].icon;
  return (
    <div className="operations">
      <header className="ops-page-heading">
        <div className="ops-page-icon"><PageIcon size={23} /></div>
        <div><h1>{sections[section].label}</h1><p>{sections[section].description}</p></div>
      </header>
      {demo && <div className="ops-demo-banner"><KeyRound size={17} /><span>Sample settings</span>{onConnect && <button type="button" className="ops-text-button" onClick={onConnect}>Sign in to make changes</button>}</div>}
      <ResourceState resource={branchesQuery} /><ResourceState resource={staff} /><ResourceState resource={lanes} />
      <div className="ops-stack" key={`${section}:${branch?.id ?? ''}:${demo ? 'demo' : 'live'}`}>
        {section === 'lanes' && <Venues branch={branch} branches={branches} lanes={laneList} staff={staffList} />}
        {section === 'pricing' && <Pricing lanes={laneList} />}
        {section === 'roster' && (branch ? <Roster branch={branch} staff={staffList} /> : !branchesQuery.isLoading && <ShellCard title="Weekly coverage"><Notice>Add a branch before creating shifts.</Notice></ShellCard>)}
        {section === 'customers' && <Customers />}
        {section === 'access' && <Access staff={staffList} />}
        {section === 'policies' && <Policies />}
      </div>
    </div>
  );
}

export default function Operations(props: OperationsProps) {
  return <OpsContext.Provider value={props}><OperationsView key={props.token ?? 'sample'} /></OpsContext.Provider>;
}
