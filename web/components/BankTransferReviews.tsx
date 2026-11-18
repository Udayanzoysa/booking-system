'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Download, Eye, FileCheck2, RefreshCw, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api, apiOrigin, ApiError, json } from '../lib/api';
import { formatBookingMoney } from './BookingDialog';

type SlipStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
type TransferSlip = {
  id: string;
  bookingId: string;
  amount: string;
  currency: string;
  reference: string | null;
  fileName: string;
  mimeType: string;
  status: SlipStatus;
  reviewNote?: string | null;
  createdAt: string;
  reviewedAt?: string | null;
  customerName?: string;
  laneName?: string;
  startsAt?: string;
};

type Props = {
  token: string;
  timezone: string;
  onChanged: () => void;
  onViewBooking: (id: string) => void;
};

const statusLabels: Record<SlipStatus, string> = { PENDING: 'Awaiting review', APPROVED: 'Approved', REJECTED: 'Rejected' };

function stamp(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-LK', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function BankTransferReviews({ token, timezone, onChanged, onViewBooking }: Props) {
  const cache = useQueryClient();
  const [status, setStatus] = useState<SlipStatus>('PENDING');
  const [review, setReview] = useState<{ slip: TransferSlip; decision: 'APPROVED' | 'REJECTED' } | null>(null);
  const [preview, setPreview] = useState<{ url: string; fileName: string; mimeType: string } | null>(null);
  const [opening, setOpening] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const slips = useQuery({
    queryKey: ['session', token, 'bank-transfer-slips', status],
    queryFn: ({ signal }) => api<TransferSlip[]>('/payments/bank-transfer-slips?status=' + status, token, { signal }),
    refetchInterval: status === 'PENDING' ? 30_000 : false,
  });

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  async function openSlip(slip: TransferSlip) {
    if (opening) return;
    setOpening(slip.id);
    setError('');
    try {
      const response = await fetch(apiOrigin + '/api/payments/bank-transfer-slips/' + slip.id + '/attachment', {
        headers: { Authorization: 'Bearer ' + token }, cache: 'no-store',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { message?: string } | null;
        throw new ApiError(response.status, body?.message ?? 'Could not open this transfer slip.');
      }
      const file = await response.blob();
      setPreview({ url: URL.createObjectURL(file), fileName: slip.fileName, mimeType: slip.mimeType });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not open this transfer slip.'); }
    finally { setOpening(''); }
  }

  function reviewed(decision: 'APPROVED' | 'REJECTED') {
    setReview(null);
    setNotice(decision === 'APPROVED' ? 'Transfer approved. The booking and payment balance have been updated.' : 'Transfer slip rejected. The booking payment balance has not changed.');
    void cache.invalidateQueries({ queryKey: ['session', token, 'bank-transfer-slips'] });
    onChanged();
  }

  return <section className="bank-review" aria-labelledby="bank-review-heading">
    <header className="bank-review-header">
      <div className="bank-review-heading"><span className="bank-review-icon"><FileCheck2 size={21}/></span><div>
        <h2 id="bank-review-heading">Bank transfer reviews</h2>
        <p>Check the bank account before approving a customer’s payment.</p>
      </div></div>
      <div className="bank-review-tools"><label>Status<select value={status} onChange={(event) => { setStatus(event.target.value as SlipStatus); setNotice(''); }}>
        <option value="PENDING">Awaiting review</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option>
      </select></label><button type="button" className="bank-review-secondary" aria-label="Refresh transfer slips" onClick={() => { void slips.refetch(); }} disabled={slips.isFetching}><RefreshCw size={15}/></button></div>
    </header>
    {(error || slips.error) && <p className="bank-review-error" role="alert">{error || slips.error?.message}</p>}
    {notice && <p className="bank-review-notice" role="status">{notice}</p>}
    {slips.isPending ? <p className="bank-review-empty" role="status">Loading transfer slips…</p> : !slips.error && !slips.data?.length ?
      <p className="bank-review-empty">{status === 'PENDING' ? 'No transfer slips are waiting for review.' : 'No ' + status.toLowerCase() + ' transfer slips.'}</p> :
      <ul className="bank-review-list">{slips.data?.map((slip) => <li key={slip.id}>
        <div className="bank-review-info"><div className="bank-review-row"><strong>{slip.customerName ?? 'Customer transfer'}</strong><span className={'bank-review-badge bank-review-' + slip.status.toLowerCase()}>{statusLabels[slip.status]}</span></div>
          <p>{slip.laneName ?? 'Booked lane'}{slip.startsAt && <> · {stamp(slip.startsAt, timezone)}</>}</p>
          <p className="bank-review-meta">Submitted {stamp(slip.createdAt, timezone)} · Reference: {slip.reference || 'Not supplied'}</p>
          {slip.reviewNote && <p className="bank-review-note">Review note: {slip.reviewNote}</p>}
          <button type="button" className="bank-review-link" onClick={() => onViewBooking(slip.bookingId)}>View booking #{slip.bookingId.slice(0, 8).toUpperCase()}</button>
        </div>
        <div className="bank-review-actions"><strong>{formatBookingMoney(slip.amount, slip.currency)}</strong>
          <div><button type="button" className="bank-review-secondary" disabled={Boolean(opening)} onClick={() => { void openSlip(slip); }}><Eye size={15}/>{opening === slip.id ? 'Opening…' : 'View slip'}</button>
            {slip.status === 'PENDING' && <><button type="button" className="bank-review-approve" onClick={() => setReview({ slip, decision: 'APPROVED' })}><Check size={15}/> Approve</button>
              <button type="button" className="bank-review-reject" onClick={() => setReview({ slip, decision: 'REJECTED' })}><X size={15}/> Reject</button></>}
          </div>
        </div>
      </li>)}</ul>}
    {review && <ReviewDialog token={token} slip={review.slip} decision={review.decision} onClose={() => setReview(null)} onReviewed={reviewed}/>}
    {preview && <SlipPreview {...preview} onClose={() => setPreview(null)}/>}
  </section>;
}

function ReviewDialog({ token, slip, decision, onClose, onReviewed }: {
  token: string; slip: TransferSlip; decision: 'APPROVED' | 'REJECTED'; onClose: () => void; onReviewed: (decision: 'APPROVED' | 'REJECTED') => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const titleId = useId();
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const approve = decision === 'APPROVED';
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      await api('/payments/bank-transfer-slips/' + slip.id + '/review', token, json('POST', { decision, ...(note.trim() ? { note: note.trim() } : {}) }));
      onReviewed(decision);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not review this transfer.'); }
    finally { busy.current = false; setPending(false); }
  }
  function close() { if (!busy.current) onClose(); }
  return <dialog ref={dialog} className="bank-review-dialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <form onSubmit={submit}><header><h2 id={titleId}>{approve ? 'Approve bank transfer' : 'Reject transfer slip'}</h2><button type="button" aria-label="Close transfer review" disabled={pending} onClick={close}><X size={19}/></button></header>
      <p>{approve ? 'Confirm that ' + formatBookingMoney(slip.amount, slip.currency) + ' has arrived in the bank account. Approval records this payment against the booking.' : 'Rejecting this slip leaves the booking balance unchanged. The customer can see your review note.'}</p>
      <label>Review note (optional)<textarea value={note} maxLength={500} rows={3} onChange={(event) => setNote(event.target.value)} placeholder={approve ? 'e.g. Matched to bank statement' : 'Explain why the payment could not be verified'}/></label>
      {error && <p className="bank-review-error" role="alert">{error}</p>}
      <footer><button type="button" className="bank-review-secondary" onClick={close} disabled={pending}>Cancel</button><button type="submit" className={approve ? 'bank-review-approve' : 'bank-review-reject'} disabled={pending}>{pending ? 'Saving…' : approve ? 'Confirm approval' : 'Reject slip'}</button></footer>
    </form>
  </dialog>;
}

function SlipPreview({ url, fileName, mimeType, onClose }: { url: string; fileName: string; mimeType: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="bank-slip-preview" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><h2 id={titleId}>Transfer slip</h2><a href={url} download={fileName}><Download size={15}/> Download</a><button type="button" aria-label="Close transfer slip" onClick={onClose}><X size={20}/></button></header>
    <p>{fileName}</p>{mimeType === 'application/pdf' ? <iframe src={url} title={'Transfer slip: ' + fileName} sandbox="allow-same-origin"/> : <img src={url} alt={'Transfer slip: ' + fileName}/>}
  </dialog>;
}
