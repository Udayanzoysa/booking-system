'use client';

import Image from 'next/image';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, FileText, Printer, ReceiptText, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, json } from '../lib/api';
import { branchMidnight, shiftDay } from '../lib/dates';
import { formatBookingMoney, type Booking } from './BookingDialog';

type DocumentEntry = { id: string; amount: string };
type Credit = DocumentEntry & { number: number; reason: string; issuedAt: string };
type Settlement = DocumentEntry & { type: string; method: string; processedAt: string | null };
type Invoice = {
  id: string; bookingId: string; number: number; customerName: string; customerEmail: string | null;
  branchName: string; branchTimeZone: string; issuerName: string; laneName: string;
  serviceStartsAt: string; serviceEndsAt: string; issuedAt: string; currency: string;
  totalAmount: string; credited: string; netAmount: string; payable: string; amountPaid: string;
  amountDue: string; overpaid: string; settlementStatus: string;
  creditNotes: Credit[]; transactions: Settlement[];
};
type BannerProps = {
  token: string | null;
  permissions: readonly string[];
  bookings: readonly Booking[];
  branches: readonly { id: string; name: string; timeZone: string }[];
  onConnect: () => void;
  onMoreBookings?: () => void;
  onChanged: () => void;
  onViewBooking?: (bookingId: string) => void;
};

type InvoiceDialogProps = {
  invoiceId: string;
  token: string | null;
  permissions: readonly string[];
  onClose: () => void;
  onChanged: () => void;
  onViewBooking?: (bookingId: string) => void;
};

function documentNumber(prefix: string, number: number) {
  return prefix + '-' + String(number).padStart(6, '0');
}

function dateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-LK', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value));
}

export default function Invoices({ token, permissions, bookings, branches, onConnect, onMoreBookings, onChanged, onViewBooking }: BannerProps) {
  const cache = useQueryClient();
  const [bookingId, setBookingId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [from, setFrom] = useState('');
  const [through, setThrough] = useState('');
  const [cursor, setCursor] = useState('');
  const manage = permissions.includes('MANAGE_INVOICES');
  const params = new URLSearchParams();
  const timeZone = branches.find((branch) => branch.id === branchId)?.timeZone ?? 'Asia/Colombo';
  if (branchId) params.set('branchId', branchId);
  if (from) params.set('startsAt', branchMidnight(from, timeZone));
  if (through) params.set('endsAt', branchMidnight(shiftDay(through, 1), timeZone));
  if (cursor) params.set('before', cursor);
  const list = useQuery({
    queryKey: ['session', token, 'invoices', params.toString()],
    queryFn: () => api<{ invoices: Invoice[]; nextCursor: string | null }>('/invoices?' + params, token),
    enabled: Boolean(token),
  });
  const issue = useMutation({
    mutationFn: (id: string) => api<Invoice>('/invoices/booking/' + encodeURIComponent(id), token, json('POST')),
    onSuccess: (invoice) => {
      cache.setQueryData(['session', token, 'invoice', invoice.id], invoice);
      void cache.invalidateQueries({ queryKey: ['session', token, 'invoices'] });
      setInvoiceId(invoice.id);
      onChanged();
    },
  });
  const error = issue.error ?? list.error;

  return <div className="invoice-page">
    <div className="invoice-title"><FileText size={25}/><div><h1>Invoices</h1><p>Issued booking invoices, payment receipts, and credit notes.</p></div></div>
    {!token ? <div className="workspace-empty"><FileText size={30}/><h2>Connect your arena to view invoices</h2>
      <button type="button" className="shell-primary" onClick={onConnect}>Connect arena</button></div> : <>
      {error && <div className="workspace-error" role="alert">{error.message}</div>}
      {manage && <form className="invoice-card invoice-controls" onSubmit={(event) => {
        event.preventDefault();
        issue.mutate(bookingId);
      }}>
        <label>Booking ID<input required list="invoice-bookings" value={bookingId} onChange={(event) => setBookingId(event.target.value.trim())} placeholder="Choose a booking or paste its ID"/></label>
        <datalist id="invoice-bookings">{bookings.filter((booking) => booking.status === 'CONFIRMED' || booking.status === 'COMPLETED').map((booking) =>
          <option key={booking.id} value={booking.id}>{booking.label ?? booking.customerName ?? booking.slot?.startsAt}</option>)}</datalist>
        {onMoreBookings && <button type="button" className="invoice-secondary" onClick={onMoreBookings}>Load more bookings</button>}
        <button className="shell-primary" disabled={issue.isPending}>Issue invoice</button>
      </form>}
      <div className="invoice-card">
        {manage && <div className="invoice-controls">
          <label>Branch<select value={branchId} onChange={(event) => { setBranchId(event.target.value); setCursor(''); }}><option value="">All branches</option>
            {branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label>
          <label>Issued from<input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setCursor(''); }}/></label>
          <label>Issued through<input type="date" value={through} onChange={(event) => { setThrough(event.target.value); setCursor(''); }}/></label>
        </div>}
        <div className="invoice-table"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Issued</th><th>Status</th><th>Balance due</th></tr></thead>
          <tbody>{list.data?.invoices.map((row) => <tr key={row.id}><td><button type="button" className="invoice-link" onClick={() => {
            setInvoiceId(row.id);
            issue.reset();
          }}>{documentNumber('INV', row.number)}</button></td><td>{row.customerName}</td><td>{dateTime(row.issuedAt, row.branchTimeZone)}</td>
            <td>{row.settlementStatus === 'SETTLED' ? 'Settled' : row.settlementStatus === 'PARTIAL' ? 'Partially paid' : 'Unpaid'}</td><td>{formatBookingMoney(row.amountDue,row.currency)}</td></tr>)}</tbody>
        </table></div>
        {list.isPending ? <p>Loading invoices…</p> : !list.data?.invoices.length && <p>No invoices for these filters.</p>}
        {(cursor || list.data?.nextCursor) && <div className="invoice-buttons">
          {cursor && <button type="button" className="invoice-secondary" onClick={() => setCursor('')}>Newest invoices</button>}
          {list.data?.nextCursor && <button type="button" className="invoice-secondary" onClick={() => setCursor(list.data!.nextCursor!)}>Older invoices</button>}
        </div>}
      </div>
      {invoiceId && <InvoiceDialog key={invoiceId} invoiceId={invoiceId} token={token} permissions={permissions}
        onClose={() => setInvoiceId('')} onChanged={onChanged} onViewBooking={onViewBooking}/>}
    </>}
  </div>;
}

export function InvoiceDialog({ invoiceId, token, permissions, onClose, onChanged, onViewBooking }: InvoiceDialogProps) {
  const cache = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [mode, setMode] = useState<'credit-notes' | 'collections' | ''>('');
  const [receiptId, setReceiptId] = useState('');
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const manage = permissions.includes('MANAGE_INVOICES');
  const queryKey = ['session', token, 'invoice', invoiceId];
  const detail = useQuery({
    queryKey,
    queryFn: ({ signal }) => api<Invoice>('/invoices/' + invoiceId, token, { signal }),
    enabled: Boolean(token),
  });
  const mutation = useMutation({
    mutationFn: ({ action, data }: { action: string; data: unknown }) =>
      api<Invoice>('/invoices/' + invoiceId + '/' + action, token, json('POST', data)),
    onSuccess: (invoice) => {
      cache.setQueryData(queryKey, invoice);
      void cache.invalidateQueries({ queryKey: ['session', token, 'invoices'] });
      setMode('');
      retry.current = null;
      onChanged();
    },
  });
  const invoice = detail.data;
  const money = (amount: string) => formatBookingMoney(amount, invoice?.currency ?? 'LKR');
  const receipt = invoice?.transactions.find((entry) => entry.id === receiptId && entry.type === 'COLLECTION');
  const error = mutation.error ?? detail.error;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => element.close();
  }, []);

  function close() {
    dialog.current?.close();
    onClose();
  }

  if (typeof document === 'undefined') return null;

  return createPortal(<dialog ref={dialog} className="invoice-dialog" aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); if (!mutation.isPending) close(); }}>
    <header className="invoice-dialog-header">
      <div>
        <h2 id={titleId}>{invoice ? documentNumber('INV', invoice.number) : 'Booking invoice'}</h2>
        {invoice && <p>{invoice.customerName}</p>}
      </div>
      <button type="button" className="invoice-secondary invoice-dialog-close" aria-label="Close invoice"
        disabled={mutation.isPending} onClick={close}><X size={18}/></button>
    </header>
    <div className="invoice-dialog-body">
      {error && <div className="workspace-error" role="alert">{error.message}</div>}
      {detail.isPending && !error && <p role="status">Loading invoice…</p>}
      {mutation.isSuccess && <p role="status">Invoice updated.</p>}
      {invoice && <>
        <article className="invoice-print">
          <header className="invoice-document-header">
            <div className="invoice-issuer">
              <div className="invoice-logo"><Image src="/techwing.png" width={144} height={144} alt="Techwing Solutions" unoptimized loading="eager" /></div>
              <strong>{invoice.issuerName}</strong>
              <span>{invoice.branchName}</span>
            </div>
            <div className="invoice-document-meta">
              <h2>{receipt ? 'Payment receipt' : 'Booking invoice'}</h2>
              <strong>{documentNumber('INV', invoice.number)}</strong>
              <p>{receipt ? 'Invoice issued' : 'Issued'} {dateTime(invoice.issuedAt, invoice.branchTimeZone)}</p>
            </div>
          </header>
          <section className="invoice-billing">
            <h3>{receipt ? 'Received from' : 'Bill to'}</h3>
            <strong>{invoice.customerName}</strong>
            {invoice.customerEmail && <p>{invoice.customerEmail}</p>}
          </section>
          {receipt ? <>
            <dl className="invoice-receipt-details">
              <div><dt>Receipt reference</dt><dd>{receipt.id}</dd></div>
              <div><dt>Payment method</dt><dd>{receipt.method.replaceAll('_', ' ')}</dd></div>
              {receipt.processedAt && <div><dt>Payment date</dt><dd>{dateTime(receipt.processedAt, invoice.branchTimeZone)}</dd></div>}
            </dl>
            <dl className="invoice-totals"><div className="invoice-total-highlight"><dt>Payment received</dt><dd>{money(receipt.amount)}</dd></div></dl>
          </> : <>
            <table className="invoice-line-items">
              <thead><tr><th scope="col">Booking details</th><th scope="col">Amount</th></tr></thead>
              <tbody><tr>
                <td><strong>{invoice.laneName}</strong><span>{dateTime(invoice.serviceStartsAt, invoice.branchTimeZone)} to {dateTime(invoice.serviceEndsAt, invoice.branchTimeZone)}</span></td>
                <td>{money(invoice.totalAmount)}</td>
              </tr></tbody>
            </table>
            <dl className="invoice-totals">
              <div><dt>Invoice total</dt><dd>{money(invoice.totalAmount)}</dd></div>
              {Number(invoice.credited) > 0 && <div><dt>Credit notes</dt><dd>−{money(invoice.credited)}</dd></div>}
              <div><dt>Net paid</dt><dd>{money(invoice.amountPaid)}</dd></div>
              <div className="invoice-total-highlight"><dt>Balance due</dt><dd>{money(invoice.amountDue)}</dd></div>
              {Number(invoice.overpaid) > 0 && <div><dt>Overpaid</dt><dd>{money(invoice.overpaid)}</dd></div>}
            </dl>
            {invoice.creditNotes.length > 0 && <section className="invoice-credits"><h3>Credit notes</h3><ul>{invoice.creditNotes.map((note) =>
              <li key={note.id}><strong>{documentNumber('CN', note.number)}</strong> · {money(note.amount)} · {note.reason}</li>)}</ul></section>}
          </>}
        </article>
        <div className="invoice-buttons invoice-actions">
          <button type="button" className="invoice-secondary" onClick={() => window.print()}><Printer size={15}/> Print or save PDF</button>
          {onViewBooking && !receipt && <button type="button" className="invoice-secondary" disabled={mutation.isPending}
            onClick={() => { close(); onViewBooking(invoice.bookingId); }}><CalendarDays size={15}/> View booking</button>}
          {receipt && <button type="button" className="invoice-secondary" onClick={() => setReceiptId('')}>Back to invoice</button>}
          {manage && !receipt && <button type="button" className="invoice-secondary" onClick={() => setMode('credit-notes')}>Issue credit note</button>}
          {manage && !receipt && Number(invoice.amountDue) > 0 && permissions.includes('RECORD_PAYMENT') &&
            <button type="button" className="invoice-secondary" onClick={() => setMode('collections')}>Record payment</button>}
        </div>
        {!receipt && invoice.transactions.length > 0 && <div className="invoice-actions"><h3>Payment activity</h3>
          <ul className="invoice-activity">{invoice.transactions.map((entry) => <li key={entry.id}>
            <span>{entry.type.replaceAll('_', ' ')} · {money(entry.amount)} · {entry.method.replaceAll('_', ' ')}</span>
            {entry.type === 'COLLECTION' && <button type="button" className="invoice-link" onClick={() => { setReceiptId(entry.id); setMode(''); }}><ReceiptText size={14}/> Receipt</button>}
          </li>)}</ul></div>}
        {mode && <form key={mode} className="invoice-controls invoice-actions" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const data = mode === 'credit-notes' ? { amount: form.get('amount'), reason: form.get('reason') } : { amount: form.get('amount'), method: form.get('method') };
          const signature = JSON.stringify([invoice.id, mode, data]);
          if (retry.current?.signature !== signature) retry.current = { signature, key: crypto.randomUUID() };
          mutation.mutate({ action: mode, data: { ...data, idempotencyKey: retry.current.key } });
        }}>
          <label>Amount<input name="amount" inputMode="decimal" required pattern="[0-9]+([.][0-9]{1,4})?" defaultValue={mode === 'collections' ? invoice.amountDue : ''}/></label>
          {mode === 'credit-notes' ? <label>Reason<input name="reason" required maxLength={500}/></label> : <label>Payment method<select name="method">
            <option value="CASH">Cash</option><option value="CARD">Card</option><option value="BANK_TRANSFER">Bank transfer</option>
          </select></label>}
          <button className="shell-primary" disabled={mutation.isPending}>{mode === 'credit-notes' ? 'Issue credit' : 'Save received payment'}</button>
          <button type="button" className="invoice-secondary" onClick={() => setMode('')}>Close form</button>
        </form>}
      </>}
    </div>
  </dialog>, document.body);
}

