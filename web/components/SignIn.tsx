'use client';

import { ArrowUpRight, LogIn, X } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { api, json } from '../lib/api';

export type Session = { token: string; name: string; tenantSlug: string };
export type Principal = { userId: string; tenantId: string; permissions: string[]; expiresAt: number };

export default function SignIn({ onClose, onSuccess }: { onClose: () => void; onSuccess: (session: Session) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [register, setRegister] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="access-dialog" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <form onSubmit={async (event) => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const tenantSlug = String(fields.get('tenantSlug')).trim();
      const email = String(fields.get('email')).trim();
      const displayName = String(fields.get('displayName') ?? '').trim();
      setError(''); setPending(true);
      try {
        const { accessToken } = await api<{ accessToken: string }>(register ? '/auth/register' : '/auth/login', null,
          json('POST', { tenantSlug, email, password: fields.get('password'), ...(register ? { displayName } : {}) }));
        await api<Principal>('/auth/me', accessToken);
        onSuccess({ token: accessToken, name: displayName || email.split('@')[0], tenantSlug });
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Unable to connect');
      } finally { setPending(false); }
    }}>
      <header className="access-header"><div className="auth-wordmark"><Image src="/techwing.png" width={210} height={210} alt="Techwing Solutions" priority /></div><button type="button" className="shell-icon" title="Close" aria-label="Close" onClick={onClose}><X size={18}/></button></header>
      <h2>{register ? 'Create a customer account' : 'Connect to your arena'}</h2>
      <p>{register ? 'Register with your arena to book and manage your own slots.' : 'Sign in with the tenant and account configured on your booking server.'}</p>
      <label>Arena slug<input name="tenantSlug" required placeholder="e.g. colombo-arena" autoComplete="organization" /></label>
      {register && <label>Full name<input name="displayName" required autoComplete="name" /></label>}
      <label>Email address<input name="email" type="email" required autoComplete="email" /></label>
      <label>Password<input name="password" type="password" required minLength={register ? 12 : 1} maxLength={128} autoComplete={register ? 'new-password' : 'current-password'} /></label>
      {error && <div className="workspace-error" role="alert">{error}</div>}
      <button className="shell-primary" disabled={pending}><LogIn size={16}/>{pending ? 'Connecting…' : register ? 'Create account' : 'Sign in'}</button>
      <button className="auth-toggle" type="button" onClick={() => { setRegister(!register); setError(''); }}>{register ? 'Already have an account? Sign in' : 'New player? Create an account'}<ArrowUpRight size={14}/></button>
    </form>
  </dialog>;
}

