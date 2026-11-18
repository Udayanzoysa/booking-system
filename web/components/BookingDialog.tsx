"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, CalendarClock, CheckCircle2, Clock3, CreditCard, FileText, Plus, Wallet, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { CalendarLane, CalendarSlot } from "./Calendar";
import { api } from "../lib/api";
import { bookingRangeSummary, bookingSlotsByIds } from "../lib/booking-range";

type LeadSource = "WHATSAPP" | "PHONE" | "WALK_IN" | "WEB";
type PaymentMethod = "CASH" | "CARD" | "BANK_TRANSFER";
type PaymentKind = "collections" | "wallet-collections" | "refunds";

export type BookingOption = { id: string; name: string; phone?: string | null };
export type Booking = {
  id: string;
  slotId: string;
  customerId: string;
  leadOwnerId: string;
  creatorId: string;
  status: "HELD" | "CONFIRMED" | "CANCELLED" | "EXPIRED" | "COMPLETED";
  paymentStatus: "UNPAID" | "DEPOSIT_PAID" | "FULLY_PAID";
  headcount: number;
  leadSource: LeadSource;
  currency: string;
  totalAmount: string;
  amountPaid: string;
  balanceDue: string;
  refundableAmount: string;
  holdExpiresAt?: string | null;
  cancellationFee?: string | null;
  tariffChange?: string;
  label?: string;
  customerName?: string;
  leadOwnerName?: string;
  creatorName?: string;
  unstaffed?: boolean;
  slot?: { id?: string; laneId: string; startsAt: string; endsAt: string; laneName?: string; timeZone?: string };
};

type PaymentPayload = { idempotencyKey: string; amount: string; method?: PaymentMethod };
type CancelPayload = { reason?: string; waiveFee?: boolean; creditWallet?: boolean };
export type CreateBookingPayload = ({ slotId: string; slotIds?: never } | { slotId?: never; slotIds: string[] }) & {
  headcount: number;
  customerId?: string;
  leadOwnerId?: string;
  leadSource?: LeadSource;
  depositRequired?: string;
  initialPayment?: Required<PaymentPayload>;
  initialWalletPaymentKey?: string;
};

export type BookingActions = {
  create: (payload: CreateBookingPayload) => Promise<Booking>;
  cancel: (id: string, payload: CancelPayload) => Promise<Booking>;
  reschedule: (id: string, payload: { slotId: string }) => Promise<Booking>;
  payment: (id: string, kind: PaymentKind, payload: PaymentPayload) => Promise<Booking>;
  uploadSlip?: (id: string, payload: { amount: string; reference?: string; idempotencyKey: string; reviewDecision: "PENDING" | "APPROVED" }, file: File) => Promise<Booking>;
  createCustomer?: (payload: { name: string; phone?: string }) => Promise<BookingOption>;
};

export type BookingDialogMode =
  | { kind: "new"; slotId?: string; slotIds?: string[] }
  | { kind: "detail" | "reschedule"; booking: Booking };

export type BookingDialogProps = {
  mode: BookingDialogMode;
  slots: CalendarSlot[];
  lanes: CalendarLane[];
  timezone: string;
  currency: string;
  staff: boolean;
  demo?: boolean;
  permissions: readonly string[];
  customers?: BookingOption[];
  leadOwners?: BookingOption[];
  currentUser?: BookingOption;
  walletBalance?: string;
  initialHeadcount?: number;
  actions: BookingActions;
  onClose: () => void;
  token?: string | null;
  onViewInvoice?: (id: string) => void;
  onCheckout?: (booking: Booking) => void;
};

const leadSources: Record<LeadSource, string> = { WHATSAPP: "WhatsApp", PHONE: "Phone", WALK_IN: "Walk-in", WEB: "Web" };

export function formatBookingMoney(amount: string | number, currency: string) {
  const value = Number(amount);
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(value);
}

export function formatBookingDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, weekday: "short", day: "numeric", month: "short", year: "numeric",
  }).format(new Date(value));
}

export function formatBookingTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function bookingState(booking: Booking): { label: string; tone: string } {
  switch (booking.status) {
    case "HELD": return { label: "Tentative hold", tone: "hold" };
    case "CANCELLED": return { label: "Cancelled", tone: "muted" };
    case "EXPIRED": return { label: "Expired", tone: "muted" };
    case "COMPLETED": return { label: "Completed", tone: "paid" };
    case "CONFIRMED": return booking.paymentStatus === "FULLY_PAID"
      ? { label: "Paid", tone: "paid" }
      : { label: "Reserved", tone: "reserved" };
  }
}

export function bookingLabel(booking: Booking, customers: BookingOption[]) {
  return booking.label || booking.customerName || customers.find((customer) => customer.id === booking.customerId)?.name || "Booking";
}

function Field({ label, children, full = false }: { label: string; children: ReactNode; full?: boolean }) {
  return <label className={full ? "bk-field bk-field-full" : "bk-field"}><span>{label}</span>{children}</label>;
}

function PaymentMethods({ method, onChange }: { method: PaymentMethod; onChange: (value: PaymentMethod) => void }) {
  return <Field label="Payment method">
    <select value={method} onChange={(event) => onChange(event.target.value as PaymentMethod)}>
      <option value="CASH">Cash</option><option value="CARD">Card</option><option value="BANK_TRANSFER">Bank transfer</option>
    </select>
  </Field>;
}

function validAmount(amount: string, maximum: number, inclusive = true) {
  const parsed = Number(amount);
  return /^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/.test(amount) && parsed > 0 &&
    (inclusive ? parsed <= maximum : parsed < maximum);
}

function SlotPicker({ available, lanes, current, timezone, onChange }: {
  available: CalendarSlot[];
  lanes: CalendarLane[];
  current?: CalendarSlot;
  timezone: string;
  onChange: (id: string) => void;
}) {
  return <>
    {lanes.length > 1 ? <Field label="Indoor ground">
      <select value={current?.laneId ?? ""} onChange={(event) => onChange(available.find((slot) => slot.laneId === event.target.value)?.id ?? "")}>
        {!current && <option value="">Select a ground</option>}
        {lanes.filter((lane) => available.some((slot) => slot.laneId === lane.id))
          .map((lane) => <option key={lane.id} value={lane.id}>{lane.name}</option>)}
      </select>
    </Field> : <div className="bk-ground-label"><span>Indoor ground</span><strong>{lanes[0]?.name ?? "Full Turf"}</strong></div>}
    <Field label="Time slot">
      <select required value={current?.id ?? ""} onChange={(event) => onChange(event.target.value)}>
        {!current && <option value="">{available.length ? "Select a session" : "No available time slots"}</option>}
        {available.filter((slot) => lanes.length === 1 || slot.laneId === current?.laneId)
          .map((slot) => <option key={slot.id} value={slot.id}>
            {formatBookingDate(slot.startsAt, timezone)} · {formatBookingTime(slot.startsAt, timezone)}–{formatBookingTime(slot.endsAt, timezone)}
          </option>)}
      </select>
    </Field>
  </>;
}

function mergeBooking(previous: Booking, updated: Booking, replacement?: CalendarSlot): Booking {
  const slot = updated.slot ?? (replacement
    ? { laneId: replacement.laneId, startsAt: replacement.startsAt, endsAt: replacement.endsAt }
    : previous.slot);
  const booking = { ...previous, ...updated, slot };
  const paid = Number(booking.amountPaid);
  const total = Number(booking.totalAmount);
  const cancelled = booking.status === "CANCELLED";
  return {
    ...booking,
    balanceDue: updated.balanceDue ?? (cancelled ? "0" : Math.max(0, total - paid).toFixed(4)),
    refundableAmount: updated.refundableAmount ?? Math.max(0, paid - (cancelled ? Number(booking.cancellationFee ?? paid) : total)).toFixed(4),
  };
}

export function BookingDialog(props: BookingDialogProps) {
  const key = props.mode.kind === "new" ? ("new-" + (props.mode.slotIds?.join(",") ?? props.mode.slotId ?? "")) : (props.mode.kind + props.mode.booking.id);
  return <BookingDialogContent key={key} {...props} />;
}

export default BookingDialog;

function BookingDialogContent({
  mode, slots, lanes, timezone, currency, staff, permissions, customers = [], leadOwners = [],
  currentUser, walletBalance, initialHeadcount = 6, actions, onClose, demo = false, token, onViewInvoice, onCheckout,
}: BookingDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const operationKeys = useRef(new Map<string, string>());
  const isRunning = useRef(false);
  const titleId = useId();
  const [booking, setBooking] = useState(mode.kind === "new" ? undefined : mode.booking);
  const [slotId, setSlotId] = useState(mode.kind === "new" ? mode.slotId ?? "" : "");
  const [panel, setPanel] = useState<"new" | "detail" | "reschedule" | "cancel" | "collect" | "refund">(mode.kind);
  const invoiceLink = useQuery({
    queryKey: ["session", token, "booking-invoice", booking?.id],
    enabled: Boolean(token && booking && panel === "detail" && onViewInvoice),
    queryFn: ({ signal }) => api<{ invoiceId: string | null }>("/invoices/booking/" + booking?.id, token, { signal }),
  });
  const invoiceId = invoiceLink.data?.invoiceId;
  const bookingTimeZone = booking?.slot?.timeZone ?? timezone;
  const [payment, setPayment] = useState<"hold" | "full" | "deposit" | "wallet">(
    staff && permissions.includes("RECORD_PAYMENT") ? "full" : "hold",
  );
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [headcount, setHeadcount] = useState(String(initialHeadcount));
  const [customerId, setCustomerId] = useState("");
  const [ownerId, setOwnerId] = useState(currentUser?.id ?? "");
  const isAdmin = permissions.includes("MANAGE_RBAC") || permissions.includes("MANAGE_USERS");
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipReference, setSlipReference] = useState("");
  const [slipDecision, setSlipDecision] = useState<"PENDING" | "APPROVED">("APPROVED");
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [addedCustomers, setAddedCustomers] = useState<BookingOption[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => element.close();
  }, []);

  useEffect(() => {
    heading.current?.focus();
  }, [panel]);

  const directory = [...customers, ...addedCustomers.filter(({ id }) => !customers.some((customer) => customer.id === id))];
  const owners = currentUser && permissions.includes("MANAGE_BOOKINGS") && !leadOwners.some(({ id }) => id === currentUser.id)
    ? [currentUser, ...leadOwners] : leadOwners;
  const sortedSlots = [...slots].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const bookableSlots = sortedSlots.filter((slot) => {
    if (!slot.price || (!demo && Date.parse(slot.startsAt) <= Date.now())) return false;
    if (panel === "reschedule" && slot.id === booking?.slotId) return false;
    return slot.status === "AVAILABLE" || (panel === "reschedule" && slot.booking?.id === booking?.id);
  });
  const fixedSlotIds = mode.kind === "new" && panel === "new" ? mode.slotIds : undefined;
  const rangeSlots = fixedSlotIds ? bookingSlotsByIds(slots, fixedSlotIds, timezone, demo ? 0 : Date.now()) : [];
  const selectedSlot = fixedSlotIds ? bookingRangeSummary(rangeSlots) : bookableSlots.find(({ id }) => id === slotId);
  useEffect(() => {
    if (!fixedSlotIds && (panel === "new" || panel === "reschedule") && lanes.length === 1 && !slotId && bookableSlots[0]) {
      setSlotId(bookableSlots[0].id);
    }
  }, [panel, lanes.length, slotId, bookableSlots[0]?.id, fixedSlotIds]);
  const amount = Number(selectedSlot?.price ?? 0);
  const wallet = Number(walletBalance ?? 0);
  const canCreateHold = permissions.includes("CREATE_UNPAID_HOLD");
  const canRecordPayment = permissions.includes("RECORD_PAYMENT");
  const canRefund = permissions.includes("ISSUE_REFUND");
  const canManage = !staff || permissions.includes("MANAGE_BOOKINGS");
  const isUpcoming = demo || !booking?.slot || Date.parse(booking.slot.startsAt) > Date.now();
  const active = isUpcoming && (booking?.status === "CONFIRMED" ||
    (booking?.status === "HELD" && (!booking.holdExpiresAt || Date.parse(booking.holdExpiresAt) > Date.now())));
  const balanceDue = Number(booking?.balanceDue ?? 0);
  const refundableAmount = Number(booking?.refundableAmount ?? 0);

  function keyFor(payload: object) {
    const signature = JSON.stringify(payload);
    const existing = operationKeys.current.get(signature);
    if (existing) return existing;
    const next = crypto.randomUUID();
    operationKeys.current.set(signature, next);
    return next;
  }

  function changePanel(next: typeof panel) {
    setError("");
    setNotice("");
    if (next === "reschedule") setSlotId("");
    setPaymentAmount(next === "collect" ? (booking?.balanceDue ?? "") : (booking?.refundableAmount ?? ""));
    setPanel(next);
  }

  async function perform(action: () => Promise<void>) {
    if (isRunning.current) return;
    isRunning.current = true;
    setProcessing(true);
    setError("");
    try {
      await action();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "This request could not be completed. Please try again.");
    } finally {
      isRunning.current = false;
      setProcessing(false);
    }
  }

  async function submitNew(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSlot || !canManage) return;
    if (fixedSlotIds && !bookingSlotsByIds(slots, fixedSlotIds, timezone, demo ? 0 : Date.now()).length) {
      setError("Your selected session has changed. Close this dialog and choose your times again.");
      return;
    }
    const players = Number(headcount);
    if (!Number.isInteger(players) || players < 1 || players > 2147483647) {
      setError("Enter a whole number of players.");
      return;
    }
    const leadOwnerId = isAdmin ? ownerId : currentUser?.id;
    if (staff && (!customerId || !leadOwnerId)) {
      setError("Choose a customer and a lead owner.");
      return;
    }
    if (amount > 0 && ((payment === "hold" && !canCreateHold) ||
      ((payment === "full" || payment === "deposit") && !canRecordPayment) ||
      (payment === "wallet" && wallet < amount))) {
      setError("Choose an available payment option.");
      return;
    }
    if (amount > 0 && payment === "deposit" && !validAmount(paymentAmount, amount, false)) {
      setError("Enter a deposit greater than zero and below the booking total.");
      return;
    }
    const payload: CreateBookingPayload = fixedSlotIds
      ? { slotIds: rangeSlots.map(slot => slot.id), headcount: players }
      : { slotId: selectedSlot.id, headcount: players };
    if (staff) Object.assign(payload, { customerId, leadOwnerId, leadSource: "WALK_IN" });
    const attachTransfer = staff && method === "BANK_TRANSFER" && Boolean(slipFile) && (payment === "full" || payment === "deposit");
    if (amount > 0 && (payment === "full" || payment === "deposit")) {
      const paid = payment === "deposit" ? paymentAmount : selectedSlot.price!;
      if (payment === "deposit") payload.depositRequired = paid;
      if (!attachTransfer) payload.initialPayment = { amount: paid, method, idempotencyKey: keyFor({ operation: "create", ...payload, paid, method }) };
    } else if (amount > 0 && payment === "wallet") {
      payload.initialWalletPaymentKey = keyFor({ operation: "create-wallet", ...payload });
    }
    await perform(async () => {
      let result = await actions.create(payload);
      setBooking(mergeBooking(result, result, selectedSlot));
      if (attachTransfer && slipFile) {
        const paid = payment === "deposit" ? paymentAmount : selectedSlot.price!;
        changePanel("collect");
        setPaymentAmount(paid);
        try { result = await saveSlip(result.id, paid); }
        catch (cause) {
          throw new Error("Booking reserved. The slip was not saved. Retry the upload below; this will use the same booking. " + (cause instanceof Error ? cause.message : ""));
        }
        setBooking(mergeBooking(result, result, selectedSlot));
        setSlipFile(null);
      }
      changePanel("detail");
      setNotice(attachTransfer && slipDecision === "PENDING" ? "Booking created. Transfer slip is awaiting staff review." : "Booking created.");
    });
  }

  function selectSlip(file: File | undefined) {
    if (!file) { setSlipFile(null); return; }
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type) || file.size === 0 || file.size > 5 * 1024 * 1024) {
      setError("Choose a JPG, PNG, or PDF transfer slip up to 5 MB.");
      setSlipFile(null);
      return;
    }
    setError(""); setSlipFile(file);
  }

  async function saveSlip(id: string, paid: string) {
    if (!slipFile || !actions.uploadSlip) throw new Error("Transfer slip uploads are unavailable. Try again shortly.");
    return actions.uploadSlip(id, {
      amount: paid, reference: slipReference.trim() || undefined, reviewDecision: slipDecision,
      idempotencyKey: keyFor({ operation: "bank-slip", bookingId: id, amount: paid, reference: slipReference.trim(), reviewDecision: slipDecision, name: slipFile.name, size: slipFile.size, lastModified: slipFile.lastModified }),
    }, slipFile);
  }

  const transferAttachment = staff && actions.uploadSlip && method === "BANK_TRANSFER" ? <div className="bk-transfer-attachment">
    <Field label="Transfer slip (optional)"><input type="file" accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf" onChange={(event) => selectSlip(event.target.files?.[0])}/></Field>
    <p className="bk-copy">{slipFile ? "Selected: " + slipFile.name : "Attach a JPG, PNG, or PDF file up to 5 MB."}</p>
    {slipFile && <><Field label="Transfer reference (optional)"><input value={slipReference} maxLength={160} onChange={(event) => setSlipReference(event.target.value)}/></Field>
      <Field label="Payment verification"><select value={slipDecision} onChange={(event) => setSlipDecision(event.target.value as "PENDING" | "APPROVED")}>
        <option value="APPROVED">Funds received — record payment</option><option value="PENDING">Save slip — awaiting review</option>
      </select></Field><p className="bk-copy">{slipDecision === "APPROVED" ? "Record payment only after checking that the transfer reached the bank account." : "The balance stays unpaid until staff approve this slip. The normal hold expiry still applies."}</p></>}
  </div> : null;

  async function addCustomer() {
    if (!actions.createCustomer) return;
    const name = customerName.trim();
    const phone = customerPhone.trim();
    if (!name || (phone && !/^\+[1-9]\d{6,14}$/.test(phone))) {
      setError("Enter a customer name and use international format for the phone number, for example +94771234567.");
      return;
    }
    await perform(async () => {
      const customer = await actions.createCustomer!({ name, phone: phone || undefined });
      setAddedCustomers((previous) => [...previous, customer]);
      setCustomerId(customer.id);
      setAddingCustomer(false);
      setCustomerName("");
      setCustomerPhone("");
    });
  }

  async function submitExisting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!booking) return;
    const contact = new FormData(event.currentTarget);
    await perform(async () => {
      let result: Booking;
      let success: string;
      switch (panel) {
        case "reschedule":
          if (!selectedSlot) throw new Error("Choose a new time slot.");
          result = await actions.reschedule(booking.id, { slotId: selectedSlot.id });
          success = "Booking rescheduled.";
          break;
        case "cancel":
          result = await actions.cancel(booking.id, {
            reason: String(contact.get("reason") ?? "").trim() || undefined,
            waiveFee: contact.has("waiveFee") || undefined,
            creditWallet: contact.has("creditWallet") || undefined,
          });
          success = "Booking cancelled.";
          break;
        default: {
          const isRefund = panel === "refund";
          const limit = isRefund ? refundableAmount : (staff ? balanceDue : Math.min(balanceDue, wallet));
          if (!validAmount(paymentAmount, limit)) {
            throw new Error(isRefund ? "Enter a refund within the refundable balance." : "Enter a payment within the available balance.");
          }
          const kind = isRefund ? "refunds" : (staff ? "collections" : "wallet-collections");
          const finalMethod = staff ? method : undefined;
          const payload = { amount: paymentAmount, method: finalMethod, idempotencyKey: keyFor({
            operation: kind, bookingId: booking.id, amount: paymentAmount, method: finalMethod,
          }) };
          if (!isRefund && staff && method === "BANK_TRANSFER" && slipFile) {
            result = await saveSlip(booking.id, paymentAmount);
            setSlipFile(null);
          } else result = await actions.payment(booking.id, kind, payload);
          operationKeys.current.clear();
          success = isRefund ? "Refund recorded." : staff && method === "BANK_TRANSFER" && slipFile && slipDecision === "PENDING" ? "Transfer slip saved for review. Payment balance has not changed." : "Payment recorded.";
        }
      }
      setBooking(mergeBooking(booking, result, panel === "reschedule" ? selectedSlot : undefined));
      changePanel("detail");
      setNotice(success);
    });
  }

  const dialogTitles = {
    new: staff ? "Quick booking" : "Book Full Turf",
    detail: "Booking details",
    reschedule: "Reschedule booking",
    cancel: "Cancel booking",
    collect: staff ? "Record payment" : "Pay from your wallet",
    refund: "Record refund",
  };
  const currentLane = lanes.find(({ id }) => id === booking?.slot?.laneId);
  const slotRecord = slots.find(({ id }) => id === booking?.slotId);
  const unstaffed = booking?.unstaffed ?? (slotRecord ? !slotRecord.staffed : false);
  const currencyCode = booking?.currency ?? currency;
  const dismiss = () => { if (!isRunning.current) onClose(); };
  const dismissLabel = panel === "new" || panel === "detail" ? "Close" : "Back";

  return <dialog ref={dialog} className="bk-dialog" aria-labelledby={titleId} onCancel={(event) => {
    event.preventDefault();
    dismiss();
  }} onClick={(event) => { if (event.target === event.currentTarget) dismiss(); }}>
    <div className="bk-dialog-shell">
      <header className="bk-dialog-header">
        <span className="bk-header-icon" aria-hidden>{panel === "collect" || panel === "refund" ? <CreditCard size={21} /> : <CalendarClock size={21} />}</span>
        <div>
          <h2 id={titleId} ref={heading} tabIndex={-1}>{dialogTitles[panel]}</h2>
          {booking && <p>{bookingLabel(booking, directory)} · #{booking.id.slice(0, 8).toUpperCase()}</p>}
        </div>
        <button className="bk-close" type="button" onClick={dismiss} disabled={processing} aria-label="Close booking dialog"><X size={19} /></button>
      </header>

      {panel === "new" && <form onSubmit={submitNew}>
        <div className="bk-body">
          <div className="bk-grid">
            {fixedSlotIds ? <>
              <div className="bk-ground-label"><span>Indoor ground</span><strong>{lanes.find(lane => lane.id === selectedSlot?.laneId)?.name ?? "Full Turf"}</strong></div>
              <div className="bk-ground-label"><span>Your session</span><strong>{selectedSlot ? formatBookingTime(selectedSlot.startsAt, timezone) + "–" + formatBookingTime(selectedSlot.endsAt, timezone) : "Session unavailable"}</strong>{selectedSlot && <span>{formatBookingDate(selectedSlot.startsAt, timezone)} · {(Date.parse(selectedSlot.endsAt) - Date.parse(selectedSlot.startsAt)) / 60_000} minutes</span>}</div>
            </> : <SlotPicker available={bookableSlots} lanes={lanes} current={selectedSlot} timezone={timezone} onChange={setSlotId} />}
            {staff && <>
              <Field label="Customer">
                <select required value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                  <option value="">Select a customer</option>
                  {directory.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.phone ? " · " + customer.phone : ""}</option>)}
                </select>
              </Field>
              {isAdmin && <Field label="Lead owner">
                <select required value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
                  <option value="">Select a lead owner</option>
                  {owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
                </select>
              </Field>}
              {actions.createCustomer && <div className="bk-field-full">
                <button type="button" className="bk-text-action" aria-expanded={addingCustomer} onClick={() => setAddingCustomer((open) => !open)}><Plus size={14} /> Add customer</button>
                {addingCustomer && <div className="bk-inline-editor">
                  <Field label="Customer name"><input value={customerName} maxLength={120} onChange={(event) => setCustomerName(event.target.value)} /></Field>
                  <Field label="Phone (optional)"><input type="tel" value={customerPhone} placeholder="+94771234567" onChange={(event) => setCustomerPhone(event.target.value)} /></Field>
                  <button className="bk-secondary" type="button" disabled={processing} onClick={addCustomer}>Save customer</button>
                </div>}
              </div>}
            </>}
            <Field label="Player count"><input required type="number" min={1} max={2147483647} value={headcount} onChange={(event) => setHeadcount(event.target.value)} /></Field>
            {selectedSlot && amount > 0 && <Field label="Payment">
              <select value={payment} onChange={(event) => setPayment(event.target.value as typeof payment)}>
                <option value="hold" disabled={!canCreateHold}>Unpaid hold</option>
                {staff && <><option value="full" disabled={!canRecordPayment}>Full payment</option><option value="deposit" disabled={!canRecordPayment}>Deposit</option></>}
                {!staff && <option value="wallet" disabled={wallet < amount}>Wallet payment</option>}
              </select>
            </Field>}
            {selectedSlot && amount > 0 && staff && payment === "deposit" &&
              <Field label="Deposit received"><input type="text" inputMode="decimal" required value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} placeholder="Enter amount" /></Field>}
            {selectedSlot && amount > 0 && staff && (payment === "full" || payment === "deposit") &&
              <PaymentMethods method={method} onChange={setMethod} />}
          </div>
          {selectedSlot && amount > 0 && staff && (payment === "full" || payment === "deposit") && transferAttachment}
          {selectedSlot && <div className="bk-quote">
            <div><span>Booking total</span><strong>{formatBookingMoney(amount, currency)}</strong></div>
            {!staff && walletBalance !== undefined && <div><span>Wallet balance</span><strong>{formatBookingMoney(walletBalance, currency)}</strong></div>}
            {staff && selectedSlot.staffed === false && <p><AlertCircle size={15} /> This slot has no roster coverage.</p>}
          </div>}
          {selectedSlot && amount > 0 && staff && (payment === "full" || payment === "deposit") &&
            <p className="bk-copy">Record this payment after it has been received.</p>}
          {!selectedSlot && <p className="bk-copy"><Clock3 size={16} /> {fixedSlotIds ? "One of your selected times is no longer available. Close this dialog and choose your times again." : bookableSlots.length ? "Choose an available ground and time." : "Select another day in the calendar to find available slots."}</p>}
          {error && <p className="bk-error" role="alert"><AlertCircle size={17} />{error}</p>}
        </div>
        <footer className="bk-dialog-footer">
          {staff && currentUser && <span>Created by {currentUser.name}</span>}
          <button type="button" className="bk-secondary" onClick={dismiss} disabled={processing}>Cancel</button>
          <button type="submit" className="bk-primary" disabled={!selectedSlot || !canManage || processing}>
            {processing ? "Saving…" : (staff ? "Create booking" : "Reserve session")}
          </button>
        </footer>
      </form>}

      {panel === "detail" && booking && <div>
        <div className="bk-body">
          {notice && <p className="bk-success" role="status"><CheckCircle2 size={17} />{notice}</p>}
          <span className={"bk-state bk-state-" + bookingState(booking).tone}>{bookingState(booking).label}</span>
          <dl className="bk-detail-grid">
            {booking.slot && <>
              <div><dt>Indoor ground</dt><dd>{booking.slot.laneName ?? currentLane?.name ?? "Full Turf"}</dd></div>
              <div><dt>Players</dt><dd>{booking.headcount}</dd></div>
              <div><dt>Date</dt><dd>{formatBookingDate(booking.slot.startsAt, bookingTimeZone)}</dd></div>
              <div><dt>Time</dt><dd>{formatBookingTime(booking.slot.startsAt, bookingTimeZone)}–{formatBookingTime(booking.slot.endsAt, bookingTimeZone)}</dd></div>
            </>}
            {staff && <>
              <div><dt>Lead source</dt><dd>{leadSources[booking.leadSource]}</dd></div>
              <div><dt>Lead owner</dt><dd>{booking.leadOwnerName ?? owners.find(({ id }) => id === booking.leadOwnerId)?.name ?? "Assigned staff"}</dd></div>
              <div><dt>Created by</dt><dd>{booking.creatorName ?? owners.find(({ id }) => id === booking.creatorId)?.name ?? "#" + booking.creatorId.slice(0, 8).toUpperCase()}</dd></div>
            </>}
            <div><dt>Total</dt><dd>{formatBookingMoney(booking.totalAmount, currencyCode)}</dd></div>
            <div><dt>Paid</dt><dd>{formatBookingMoney(booking.amountPaid, currencyCode)}</dd></div>
            {active && balanceDue > 0 && <div><dt>Balance due</dt><dd>{formatBookingMoney(balanceDue, currencyCode)}</dd></div>}
            {refundableAmount > 0 && <div><dt>Refundable</dt><dd>{formatBookingMoney(refundableAmount, currencyCode)}</dd></div>}
            {booking.cancellationFee != null && <div><dt>Cancellation fee</dt><dd>{formatBookingMoney(booking.cancellationFee, currencyCode)}</dd></div>}
          </dl>
          {active && booking.holdExpiresAt && <p className="bk-copy"><Clock3 size={16} /> Hold expires at {formatBookingTime(booking.holdExpiresAt, timezone)}.</p>}
          {staff && unstaffed && <p className="bk-copy"><AlertCircle size={16} /> This slot has no roster coverage.</p>}
        </div>
        <footer className="bk-dialog-footer">
          {active && canManage && <button type="button" className="bk-danger-outline" onClick={() => changePanel("cancel")}>Cancel booking</button>}
          <button type="button" className="bk-secondary" onClick={dismiss}>Close</button>
          {invoiceId && onViewInvoice && <button type="button" className="bk-secondary" onClick={() => onViewInvoice(invoiceId)}><FileText size={15} /> View invoice</button>}
          {active && canManage && <button type="button" className="bk-secondary" onClick={() => changePanel("reschedule")}>Reschedule</button>}
          {!staff && active && balanceDue > 0 && onCheckout &&
            <button type="button" className="bk-primary" onClick={() => onCheckout(booking)}><CreditCard size={15} /> Pay booking</button>}
          {active && balanceDue > 0 && (staff ? canRecordPayment : wallet >= balanceDue) &&
            <button type="button" className="bk-primary" onClick={() => changePanel("collect")}>{staff ? "Record payment" : "Pay with wallet"}</button>}
          {staff && canRefund && refundableAmount > 0 && <button type="button" className="bk-primary" onClick={() => changePanel("refund")}>Record refund</button>}
        </footer>
      </div>}

      {panel !== "new" && panel !== "detail" && booking && <form onSubmit={submitExisting}>
        <div className="bk-body">
          {panel === "reschedule" && <>
            <div className="bk-grid"><SlotPicker available={bookableSlots} lanes={lanes} current={selectedSlot} timezone={timezone} onChange={setSlotId} /></div>
            {selectedSlot && <div className="bk-quote">
              <div><span>New total</span><strong>{formatBookingMoney(amount, currencyCode)}</strong></div>
              <div><span>Price difference</span><strong>{formatBookingMoney(amount - Number(booking.totalAmount), currencyCode)}</strong></div>
              {staff && !selectedSlot.staffed && <p><AlertCircle size={15} /> This slot has no roster coverage.</p>}
            </div>}
            {!selectedSlot && <p className="bk-copy"><Clock3 size={16} /> {bookableSlots.length ? "Choose an available ground and time." : "Select another day in the calendar to find available slots."}</p>}
          </>}
          {panel === "cancel" && <div className="bk-stack">
            <p className="bk-copy">Cancelling releases the time slot. The booking’s cancellation policy determines the final fee and refundable balance.</p>
            <Field label="Reason (optional)"><textarea name="reason" rows={3} maxLength={1000} /></Field>
            {staff && permissions.includes("WAIVE_CANCELLATION_FEE") &&
              <label className="bk-check"><input type="checkbox" name="waiveFee" /> Waive cancellation fee</label>}
            {Number(booking.amountPaid) > 0 && (!staff || canRefund) &&
              <label className="bk-check"><input type="checkbox" name="creditWallet" /> Credit the wallet if the policy allows</label>}
          </div>}
          {(panel === "collect" || panel === "refund") && <>
            <div className="bk-grid">
              <Field label={panel === "refund" ? "Refund amount" : "Payment amount"}>
                <input required type="text" inputMode="decimal" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} />
              </Field>
              {staff && <PaymentMethods method={method} onChange={setMethod} />}
            </div>
            {panel === "collect" && transferAttachment}
            {!staff && <p className="bk-copy"><Wallet size={16} /> Wallet balance {formatBookingMoney(wallet, currencyCode)}</p>}
            {staff && <p className="bk-copy">{panel === "refund" ? "Record a refund already issued through the original payment method." : "Record a payment after it has been received."}</p>}
          </>}
          {error && <p className="bk-error" role="alert"><AlertCircle size={17} />{error}</p>}
        </div>
        <footer className="bk-dialog-footer">
          <button type="button" className="bk-secondary" onClick={() => changePanel("detail")} disabled={processing}><ArrowLeft size={15} />{dismissLabel}</button>
          <button type="submit" className={panel === "cancel" ? "bk-danger" : "bk-primary"} disabled={processing || (panel === "reschedule" && !selectedSlot)}>
            {processing ? "Saving…" : ({ reschedule: "Save new slot", cancel: "Confirm cancellation", collect: staff ? "Record payment" : "Pay now", refund: "Record refund" })[panel]}
          </button>
        </footer>
      </form>}
    </div>
  </dialog>;
}
