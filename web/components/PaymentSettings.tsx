'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CheckCircle2, CreditCard, LockKeyhole, Save } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, json } from '../lib/api';
import '../app/payment-settings.css';

type BankSettings = {
  bankTransferEnabled: boolean;
  bankName: string;
  accountName: string;
  accountNumber: string;
  bankBranch?: string;
  instructions?: string;
  payhereEnabled: boolean;
  payhereSandbox: boolean;
  payhereMerchantId: string;
  payhereMerchantSecretConfigured: boolean;
  payhereNotifyUrl: string;
  payhereReturnOrigin: string;
  contactPhone: string;
  encryptionAvailable: boolean;
};
type PaymentOptions = { payhere: { enabled: boolean; sandbox: boolean } };

export function PaymentSettings({ token, onChanged }: { token: string; onChanged?: () => void }) {
  const cache = useQueryClient();
  const settings = useQuery({
    queryKey: ['payment-settings', token],
    queryFn: ({ signal }) => api<BankSettings>('/payments/settings', token, { signal }),
    refetchOnWindowFocus: false,
  });
  const options = useQuery({
    queryKey: ['payment-options', token],
    queryFn: ({ signal }) => api<PaymentOptions>('/payments/options', token, { signal }),
  });
  return <div className="ps-page">
    <header className="ps-heading"><CreditCard size={30}/><div><h1>Payment settings</h1><p>Choose how players pay for their bookings.</p></div></header>
    {settings.isPending ? <p role="status">Loading payment settings…</p> : settings.error ? <div className="ps-error" role="alert">{settings.error.message} <button onClick={() => void settings.refetch()}>Retry</button></div> : settings.data && <><BankSettingsForm token={token} initial={settings.data} onSaved={(value) => {
      cache.setQueryData(['payment-settings', token], value);
      void cache.invalidateQueries({ queryKey: ['payment-options'] });
      onChanged?.();
    }}/><GatewaySettingsForm token={token} initial={settings.data} available={Boolean(options.data?.payhere.enabled)} onSaved={(value) => {
      cache.setQueryData(['payment-settings', token], value);
      void cache.invalidateQueries({ queryKey: ['payment-options'] });
      onChanged?.();
    }}/></>}
  </div>;
}

function GatewaySettingsForm({ token, initial, available, onSaved }: { token: string; initial: BankSettings; available: boolean; onSaved: (value: BankSettings) => void }) {
  const [enabled, setEnabled] = useState(initial.payhereEnabled);
  const [secret, setSecret] = useState('');
  const [clearSecret, setClearSecret] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? '').trim();
    setPending(true); setError(''); setSaved(false);
    try {
      const result = await api<BankSettings>('/payments/settings', token, json('PUT', {
        payhereEnabled: enabled, payhereSandbox: true,
        payhereMerchantId: text('merchantId'), payhereNotifyUrl: text('notifyUrl'), payhereReturnOrigin: text('returnOrigin'),
        contactPhone: text('contactPhone'),
        ...(secret ? { payhereMerchantSecret: secret } : {}),
        ...(clearSecret ? { clearPayhereMerchantSecret: true } : {}),
      }));
      setSecret(''); setClearSecret(false); setSaved(true); onSaved(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save PayHere settings.'); }
    finally { setPending(false); }
  }
  return <section className="ps-card" aria-labelledby="gateway-title"><div className="ps-card-title"><CreditCard size={23}/><div><h2 id="gateway-title">PayHere checkout</h2><p>Connect the club’s sandbox merchant account. Payment confirmation comes from verified server notifications.</p></div><span className={'ps-status ' + (available ? 'ready' : '')}>{available ? 'Connected' : 'Not enabled'}</span></div>
    <form onSubmit={submit} onChange={() => setSaved(false)}><fieldset disabled={pending}>
      <label className="ps-toggle"><input type="checkbox" checked={Boolean(enabled)} onChange={(event) => setEnabled(event.target.checked)} disabled={clearSecret}/><span>Enable PayHere sandbox checkout</span></label>
      <div className="ps-fields">
        <label>Payment environment<select name="environment" value="sandbox" onChange={() => undefined}><option value="sandbox">Sandbox — test payments</option><option value="live" disabled>Live — not available yet</option></select></label>
        <label>Merchant ID<input name="merchantId" defaultValue={initial.payhereMerchantId} required={enabled} maxLength={120} autoComplete="off" placeholder="PayHere sandbox Merchant ID"/></label>
        <label className="ps-wide">Merchant secret<input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} required={enabled && !initial.payhereMerchantSecretConfigured} disabled={clearSecret} maxLength={1000} autoComplete="new-password" placeholder={initial.payhereMerchantSecretConfigured ? '•••••••• — leave empty to keep the stored secret' : 'Enter the sandbox Merchant Secret'}/><small className="ps-field-note"><LockKeyhole size={13}/>{initial.payhereMerchantSecretConfigured ? 'A secret is saved. Enter a replacement only when changing it.' : 'No secret is saved.'} Secrets are encrypted and never shown after saving.</small></label>
        <label className="ps-wide">Notification URL<input name="notifyUrl" type="url" defaultValue={initial.payhereNotifyUrl} required={enabled} maxLength={2048} placeholder="https://your-domain/api/payments/payhere/notify"/><small className="ps-field-note">PayHere must reach this HTTPS URL. Localhost notifications are not supported.</small></label>
        <label>Return origin<input name="returnOrigin" type="url" defaultValue={initial.payhereReturnOrigin} required={enabled} maxLength={2048} placeholder="https://your-domain"/></label>
        <label>Club contact phone<input name="contactPhone" type="tel" defaultValue={initial.contactPhone || '070 126 1966'} maxLength={30} placeholder="070 126 1966"/><small className="ps-field-note">Shown when players call about a held or deposit booking.</small></label>
      </div>
      {initial.payhereMerchantSecretConfigured && <label className="ps-toggle ps-clear-secret"><input type="checkbox" checked={clearSecret} onChange={(event) => { setClearSecret(event.target.checked); if (event.target.checked) { setEnabled(false); setSecret(''); } }}/><span>Remove stored merchant secret and disable checkout</span></label>}
      {!initial.encryptionAvailable && <p className="ps-warning">Secure credential storage needs the server’s payment encryption key before a merchant secret can be saved.</p>}
      <p className="ps-muted">Sandbox payments are for testing and do not collect real money. Add this site’s domain to your PayHere sandbox merchant account.</p>
      <button className="ps-save" type="submit"><Save size={17}/>{pending ? 'Saving…' : 'Save PayHere & contact details'}</button>
    </fieldset>{error && <p className="ps-error" role="alert">{error}</p>}{saved && <p className="ps-success" role="status"><CheckCircle2 size={17}/>PayHere and contact settings saved.</p>}</form>
  </section>;
}

function BankSettingsForm({ token, initial, onSaved }: { token: string; initial: BankSettings; onSaved: (value: BankSettings) => void }) {
  const [enabled, setEnabled] = useState(initial.bankTransferEnabled);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? '').trim();
    setPending(true); setError(''); setSaved(false);
    try {
      const result = await api<BankSettings>('/payments/settings', token, json('PUT', {
        bankTransferEnabled: enabled, bankName: text('bankName'), accountName: text('accountName'),
        accountNumber: text('accountNumber'), bankBranch: text('bankBranch'), instructions: text('instructions'),
      }));
      onSaved(result); setSaved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save bank details.'); }
    finally { setPending(false); }
  }
  return <section className="ps-card" aria-labelledby="bank-settings-title"><div className="ps-card-title"><Building2 size={23}/><div><h2 id="bank-settings-title">Bank transfer</h2><p>These details appear to players at checkout. Staff review each uploaded transfer slip before applying payment.</p></div></div>
    <form onSubmit={submit} onChange={() => setSaved(false)}><fieldset disabled={pending}>
      <label className="ps-toggle"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)}/><span>Accept bank transfers</span></label>
      <div className="ps-fields">
        <label>Bank name<input name="bankName" required={enabled} maxLength={120} defaultValue={initial.bankName} placeholder="Bank name"/></label>
        <label>Account holder<input name="accountName" required={enabled} maxLength={160} defaultValue={initial.accountName} placeholder="Account holder name"/></label>
        <label>Account number<input name="accountNumber" required={enabled} maxLength={80} defaultValue={initial.accountNumber} placeholder="Account number" autoComplete="off"/></label>
        <label>Bank branch <small>(optional)</small><input name="bankBranch" maxLength={120} defaultValue={initial.bankBranch ?? ''} placeholder="Branch name"/></label>
        <label className="ps-wide">Transfer instructions <small>(optional)</small><textarea name="instructions" rows={3} maxLength={1000} defaultValue={initial.instructions ?? ''} placeholder="For example, include your booking reference in the transfer description."/></label>
      </div>
      <button type="submit" className="ps-save"><Save size={17}/>{pending ? 'Saving…' : 'Save bank details'}</button>
    </fieldset>{error && <p className="ps-error" role="alert">{error}</p>}{saved && <p className="ps-success" role="status"><CheckCircle2 size={17}/>Bank details saved. Customer checkout now uses these details.</p>}</form>
  </section>;
}
