'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ArrowRight, Building2, CheckCircle2, Clock3, CreditCard, Download, FileUp, ShieldCheck, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api, apiOrigin, json } from '../../lib/api';
import { formatBookingMoney, type Booking } from '../BookingDialog';

type PaymentOptions = {
  payhere: { enabled: boolean; sandbox: true };
  bankTransfer: { enabled: boolean; bankName: string; accountName: string; accountNumber: string; branch?: string; instructions?: string };
};
type Slip = {
  id: string; bookingId: string; amount: string; currency: string; reference?: string | null;
  fileName: string; mimeType: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; reviewNote?: string | null; createdAt: string;
};
type Props = { booking: Booking; token: string; timeZone: string; contactPhone?: string; onClose: () => void; onChanged: () => void };

export function CustomerCheckout({ booking: initialBooking, token, timeZone, contactPhone = '070 126 1966', onClose, onChanged }: Props) {
  const phoneDigits = contactPhone.replace(/[^\d+]/g, '');
  const contactHref = 'tel:' + (phoneDigits.startsWith('0') ? '+94' + phoneDigits.slice(1) : phoneDigits);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [method, setMethod] = useState<'payhere' | 'bank'>('payhere');
  const [amount, setAmount] = useState(Number(initialBooking.balanceDue).toFixed(2));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  const keys = useRef(new Map<string, string>());
  const [now, setNow] = useState(Date.now());
  const bookingQuery = useQuery({ queryKey: ['customer', token, 'checkout-booking', initialBooking.id], queryFn: ({ signal }) => api<Booking>('/bookings/' + initialBooking.id, token, { signal }), refetchInterval: 5_000 });
  const booking = bookingQuery.data ?? initialBooking;
  const options = useQuery({ queryKey: ['customer', token, 'payment-options'], queryFn: ({ signal }) => api<PaymentOptions>('/payments/options', token, { signal }), refetchOnMount: 'always', refetchInterval: 10_000 });
  const slips = useQuery({ queryKey: ['customer', token, 'slips', booking.id], queryFn: ({ signal }) => api<Slip[]>('/payments/' + booking.id + '/bank-transfer-slips', token, { signal }), refetchInterval: 10_000 });
  const balance = Number(booking.balanceDue);
  const deposit = Number((booking as Booking & { depositRequired?: string }).depositRequired ?? '0');
  const minimumPayment = deposit > 0 ? Math.max(0.01, Math.min(balance, deposit - Number(booking.amountPaid))) : balance;
  const active = (booking.status === 'CONFIRMED' || booking.status === 'HELD' && Boolean(booking.holdExpiresAt && Date.parse(booking.holdExpiresAt) > now))
    && (!booking.slot || Date.parse(booking.slot.startsAt) > now);
  const bank = options.data?.bankTransfer;
  const pendingSlip = slips.data?.some((slip) => slip.status === 'PENDING');
  const fullyPaid = balance <= 0;
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (bookingQuery.data && (bookingQuery.data.amountPaid !== initialBooking.amountPaid || bookingQuery.data.status !== initialBooking.status)) onChanged(); }, [bookingQuery.data?.amountPaid, bookingQuery.data?.status]);

  function operationKey(signature: string) {
    if (!keys.current.has(signature)) keys.current.set(signature, crypto.randomUUID());
    return keys.current.get(signature)!;
  }
  async function payHere(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running.current) return;
    const billing = new FormData(event.currentTarget);
    running.current = true;
    setPending(true); setError(''); setNotice('');
    try {
      const billingAddress = String(billing.get('billingAddress') ?? '').trim();
      const billingCity = String(billing.get('billingCity') ?? '').trim();
      const billingPhone = String(billing.get('billingPhone') ?? '').trim();
      const checkout = await api<{ url: string; fields: Record<string, string> }>('/payments/' + booking.id + '/payhere', token, json('POST', { idempotencyKey: operationKey(JSON.stringify(['payhere', booking.balanceDue, billingAddress, billingCity, billingPhone])), billingAddress, billingCity, billingPhone }));
      const target = new URL(checkout.url);
      if (target.protocol !== 'https:' || target.hostname !== 'sandbox.payhere.lk' || target.pathname !== '/pay/checkout') throw new Error('The sandbox payment page is unavailable. Contact the club.');
      const form = document.createElement('form');
      form.method = 'POST'; form.action = checkout.url;
      for (const [name, value] of Object.entries(checkout.fields)) { const input = document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; form.appendChild(input); }
      document.body.appendChild(form);
      form.submit();
      form.remove();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not open PayHere.'); }
    finally { running.current = false; setPending(false); }
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const file = fields.get('attachment');
    if (!(file instanceof File) || !file.size) { setError('Choose your transfer slip.'); return; }
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type) || file.size > 5 * 1024 * 1024) { setError('Choose a JPG, PNG, or PDF file up to 5 MB.'); return; }
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount) || Number(amount) < minimumPayment || Number(amount) > balance) { setError(minimumPayment === balance ? 'This booking requires the full remaining balance of ' + formatBookingMoney(balance, booking.currency) + '.' : 'Enter an amount from ' + formatBookingMoney(minimumPayment, booking.currency) + ' to ' + formatBookingMoney(balance, booking.currency) + ', with up to two decimal places.'); return; }
    const reference = String(fields.get('reference') ?? '').trim();
    fields.set('amount', amount); fields.set('reference', reference);
    fields.set('idempotencyKey', operationKey(JSON.stringify([amount, reference, file.name, file.size, file.lastModified])));
    running.current = true; setPending(true); setError(''); setNotice('');
    try {
      const response = await fetch(apiOrigin + '/api/payments/' + booking.id + '/bank-transfer-slips', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fields });
      const data = await response.json().catch(() => null) as { message?: string | string[] } | null;
      if (!response.ok) throw new Error([data?.message ?? 'Could not upload your transfer slip.'].flat().join(' · '));
      setNotice('Slip uploaded. The club will check the transfer before confirming payment.');
      form.reset(); keys.current.clear(); await slips.refetch(); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not upload your transfer slip.'); }
    finally { running.current = false; setPending(false); }
  }
  async function download(slip: Slip) {
    try {
      const response = await fetch(apiOrigin + '/api/payments/bank-transfer-slips/' + slip.id + '/attachment', { headers: { Authorization: 'Bearer ' + token } });
      if (!response.ok) throw new Error('Could not download this attachment.');
      const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a');
      link.href = url; link.download = slip.fileName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not download attachment.'); }
  }
  return <dialog ref={dialog} className="cp-checkout" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); if (!pending) onClose(); }}>
    <header className="cp-checkout-header"><div><p className="cp-eyebrow">STRIKZ CLUB · CHECKOUT</p><h2 id={titleId}>Pay for your session</h2></div><button type="button" aria-label="Close checkout" disabled={pending} onClick={onClose}><X size={21}/></button></header>
    <div className="cp-checkout-content">
      <section className="cp-checkout-summary"><div><strong>{booking.slot?.laneName ?? 'Cricket session'}</strong><span>{booking.slot ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: booking.slot.timeZone ?? timeZone }).format(new Date(booking.slot.startsAt)) : 'Booking #' + booking.id.slice(0, 8).toUpperCase()}</span><small>Booking #{booking.id.slice(0, 8).toUpperCase()}</small></div><div><span>Balance due</span><strong>{formatBookingMoney(booking.balanceDue, booking.currency)}</strong><small>{formatBookingMoney(booking.amountPaid, booking.currency)} already paid</small></div></section>
      {booking.status === 'HELD' && booking.holdExpiresAt && <div className="cp-checkout-hold"><Clock3 size={17}/><span>Slot held until {new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }).format(new Date(booking.holdExpiresAt))}. Payment must be verified before the hold expires.</span></div>}
      {(error || options.error || slips.error || bookingQuery.error) && <p className="cp-error" role="alert">{error || options.error?.message || slips.error?.message || bookingQuery.error?.message}</p>}
      {notice && <p className="cp-checkout-success" role="status"><CheckCircle2 size={18}/>{notice}</p>}
      {fullyPaid ? <div className="cp-checkout-paid"><CheckCircle2 size={30}/><h3>Payment complete</h3><p>Your booking balance is settled.</p></div> : !active ? <p className="cp-error"><AlertCircle size={17}/>This booking is no longer open for payment. Contact the club if you already transferred funds.</p> : <>
        <div className="cp-payment-tabs" role="group" aria-label="Payment method"><button type="button" aria-pressed={method === 'payhere'} onClick={() => { setMethod('payhere'); setError(''); }}><CreditCard size={20}/><span><strong>PayHere</strong><small>Sandbox checkout</small></span></button><button type="button" aria-pressed={method === 'bank'} onClick={() => { setMethod('bank'); setError(''); void options.refetch(); }}><Building2 size={20}/><span><strong>Bank transfer</strong><small>Upload your transfer slip</small></span></button></div>
        {options.isPending ? <p role="status" className="cp-muted">Loading payment methods…</p> : method === 'payhere' ? <section className="cp-payhere-panel">
          <span className="cp-sandbox-badge">SANDBOX · TEST PAYMENTS</span><h3>Pay securely with PayHere</h3>
          <p>Continue to PayHere’s sandbox to pay the remaining {formatBookingMoney(booking.balanceDue, booking.currency)}. This environment is for testing.</p>
          {options.data?.payhere.enabled && <form className="cp-slip-form cp-billing-form" onSubmit={(event) => { void payHere(event); }}>
            <label>Billing address<input required name="billingAddress" autoComplete="street-address" maxLength={160}/></label>
            <div className="cp-slip-fields"><label>City<input required name="billingCity" autoComplete="address-level2" maxLength={80}/></label><label>Phone number<input required name="billingPhone" autoComplete="tel" type="tel" maxLength={24} placeholder="e.g. +94771234567"/></label></div>
            <p className="cp-muted">Your booking updates after PayHere sends a verified payment notification.</p>
            <button className="cp-primary" disabled={pending || Boolean(pendingSlip)}>{pending ? 'Opening checkout…' : 'Continue to PayHere'}<ArrowRight size={16}/></button>
          </form>}
          {!options.data?.payhere.enabled && <p className="cp-payment-unavailable">PayHere sandbox is being set up. Please use bank transfer when available or contact the club.</p>}
          {pendingSlip && <p className="cp-payment-unavailable">A bank transfer is awaiting review. Please wait for the club to review it before making another payment.</p>}
        </section> : !bank?.enabled ? <section className="cp-payhere-panel"><Building2 size={27}/><h3>Bank transfer details are being prepared</h3><p>The club will add its bank account here. Please contact the club before transferring money.</p><a className="cp-text-link" href={contactHref}>Call {contactPhone}<ArrowRight size={15}/></a></section> : <section className="cp-bank-panel">
          <div className="cp-bank-details"><h3>Transfer to the club’s account</h3><dl><div><dt>Bank</dt><dd>{bank.bankName}</dd></div><div><dt>Account name</dt><dd>{bank.accountName}</dd></div><div><dt>Account number</dt><dd>{bank.accountNumber}</dd></div>{bank.branch && <div><dt>Branch</dt><dd>{bank.branch}</dd></div>}</dl>{bank.instructions && <p>{bank.instructions}</p>}<p>Use booking #{booking.id.slice(0, 8).toUpperCase()} as your transfer reference.</p></div>
          <form onSubmit={upload} className="cp-slip-form">
            <h3>Attach your transfer slip</h3>
            <div className="cp-slip-fields">
              <label><span className="cp-field-label">Amount transferred ({booking.currency})</span><input required name="amount" type="number" inputMode="decimal" min={minimumPayment} step="0.01" max={balance} readOnly={minimumPayment === balance} value={amount} onChange={(event) => setAmount(event.target.value)}/></label>
              <label><span className="cp-field-label">Transfer reference <small>(optional)</small></span><input name="reference" maxLength={120} placeholder="Bank transaction reference"/></label>
            </div>
            <label className="cp-file-field"><FileUp size={22}/><span>Transfer slip</span><input required name="attachment" type="file" accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf"/><small>JPG, PNG, or PDF · up to 5 MB</small></label>
            <p className="cp-muted">This booking requires {minimumPayment === balance ? 'the full remaining balance' : 'at least ' + formatBookingMoney(minimumPayment, booking.currency)}. Uploading a slip does not mark it as paid; staff will verify the funds received.</p>
            <button className="cp-primary" disabled={pending || Boolean(pendingSlip)}>{pending ? 'Uploading…' : 'Submit slip for review'}<FileUp size={16}/></button>
            {pendingSlip && <p className="cp-payment-unavailable">Your transfer slip is already awaiting review.</p>}
          </form>
        </section>}
      </>}
      {Boolean(slips.data?.length) && <section className="cp-slip-history"><h3>Transfer slip history</h3>{slips.data!.map((slip) => <article key={slip.id}><div className="cp-slip-history-title"><strong>{formatBookingMoney(slip.amount, slip.currency)}</strong><span className={'cp-slip-status ' + slip.status.toLowerCase()}>{slip.status === 'PENDING' ? 'Awaiting review' : slip.status === 'APPROVED' ? 'Approved' : 'Rejected'}</span></div><p>{new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(slip.createdAt))}{slip.reference && ' · ' + slip.reference}</p><button type="button" onClick={() => { void download(slip); }}><Download size={14}/>{slip.fileName}</button>{slip.reviewNote && <p className="cp-review-note">Staff note: {slip.reviewNote}</p>}</article>)}</section>}
    </div><footer className="cp-checkout-footer"><ShieldCheck size={15}/><span>Payments are linked to this booking. Need help? Call {contactPhone}.</span></footer>
  </dialog>;
}
