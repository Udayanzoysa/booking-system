'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, LockKeyhole } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { Principal } from '../lib/session';
import { hasDashboardAccess } from '../lib/dashboard-access';

export default function LoginForm({ destination, serviceUnavailable }: { destination: string; serviceUnavailable: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(serviceUnavailable ? 'The booking service is unavailable. Try signing in again shortly.' : '');
  const tenantSlug = process.env.NEXT_PUBLIC_CUSTOMER_TENANT_SLUG?.trim() ?? '';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const fields = new FormData(event.currentTarget);
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', tenantSlug: String(fields.get('tenantSlug')).trim(), email: String(fields.get('email')).trim(), password: fields.get('password') }),
      });
      const result: { principal?: Principal; message?: string } = await response.json();
      if (!response.ok || !result.principal) throw new Error(result.message ?? 'Could not sign in.');
      sessionStorage.removeItem('techwing-booking-session');
      router.replace(hasDashboardAccess(result.principal.permissions) ? destination : '/book');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not sign in. Try again.');
      setPending(false);
    }
  }

  return <main className="staff-login">
    <Link href="/" className="staff-login-back"><ArrowLeft size={16} /> Back to Strikz Club</Link>
    <section className="staff-login-card" aria-labelledby="staff-login-title">
      <div className="staff-login-brand"><Image src="/techwing.png" width={190} height={190} alt="Techwing Solutions" priority /></div>
      <span className="staff-login-icon"><LockKeyhole size={19} /></span>
      <h1 id="staff-login-title">Staff sign in</h1>
      <p>Sign in to manage your arena’s bookings and operations.</p>
      <form onSubmit={submit} aria-busy={pending}>
        <label>Arena slug<input name="tenantSlug" defaultValue={tenantSlug} required autoComplete="organization" maxLength={100} placeholder="Your arena" /></label>
        <label>Email address<input name="email" type="email" required autoComplete="username" maxLength={254} /></label>
        <label>Password<input name="password" type="password" required autoComplete="current-password" maxLength={128} /></label>
        {error && <p className="staff-login-error" role="alert">{error}</p>}
        <button type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}<ArrowRight size={17} /></button>
      </form>
      <p className="staff-login-player">Booking a session? <Link href="/book">Open player bookings</Link></p>
    </section>
  </main>;
}
