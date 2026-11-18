'use client';

import { useEffect, useRef, useState } from 'react';
import type { Principal, Session } from '../../lib/session';

type GoogleCredential = { credential?: string };
type GoogleIdentity = {
  initialize: (options: { client_id: string; nonce: string; callback: (response: GoogleCredential) => void; auto_select: boolean; ux_mode: 'popup' }) => void;
  renderButton: (element: HTMLElement, options: { type: 'standard'; theme: 'outline'; size: 'large'; text: 'continue_with'; shape: 'rectangular'; width: number; logo_alignment: 'left' }) => void;
};
type GoogleWindow = Window & { google?: { accounts?: { id?: GoogleIdentity } } };
type Props = {
  tenantSlug: string;
  mode?: 'login' | 'link';
  disabled?: boolean;
  onPendingChange?: (pending: boolean) => void;
  onSuccess: (result: { session: Session; principal: Principal }) => void;
};
const scriptUrl = 'https://accounts.google.com/gsi/client';
let scriptPromise: Promise<void> | undefined;

function loadGoogle(): Promise<void> {
  if ((window as GoogleWindow).google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    let element = document.querySelector<HTMLScriptElement>('script[src="' + scriptUrl + '"]');
    const owned = !element;
    if (!element) {
      element = document.createElement('script');
      element.src = scriptUrl;
      element.async = true;
      element.defer = true;
    }
    const script = element;
    const timeout = window.setTimeout(failed, 12_000);
    function cleanup() { clearTimeout(timeout); script.removeEventListener('load', loaded); script.removeEventListener('error', failed); }
    function loaded() {
      cleanup();
      if ((window as GoogleWindow).google?.accounts?.id) resolve();
      else failed();
    }
    function failed() {
      cleanup();
      if (owned) script.remove();
      scriptPromise = undefined;
      reject(new Error('Google sign-in could not load. Check your connection or use email sign-in.'));
    }
    script.addEventListener('load', loaded, { once: true });
    script.addEventListener('error', failed, { once: true });
    if (owned) document.head.appendChild(script);
  });
  return scriptPromise;
}

export function GoogleSignIn({ tenantSlug, mode = 'login', disabled = false, onPendingChange, onSuccess }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onPendingChange, onSuccess, disabled });
  callbacks.current = { onPendingChange, onSuccess, disabled };
  const busy = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'disabled' | 'working' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    const element = host.current;
    if (element) element.replaceChildren();
    async function start() {
      const response = await fetch('/api/google-sign-in?tenant=' + encodeURIComponent(tenantSlug), {
        credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      });
      const config = await response.json() as { enabled?: boolean; clientId?: string; nonce?: string; message?: string };
      if (!response.ok) throw new Error(config.message ?? 'Google sign-in is unavailable. Use email sign-in or retry.');
      if (!config.enabled) { if (!controller.signal.aborted) setStatus('disabled'); return; }
      if (!config.clientId || !config.nonce) throw new Error('Google sign-in is unavailable. Use email sign-in.');
      await loadGoogle();
      if (controller.signal.aborted || !element) return;
      const google = (window as GoogleWindow).google?.accounts?.id;
      if (!google) throw new Error('Google sign-in could not load.');
      google.initialize({
        client_id: config.clientId, nonce: config.nonce, auto_select: false, ux_mode: 'popup',
        callback: (credential) => {
          if (controller.signal.aborted || busy.current || callbacks.current.disabled) return;
          if (!credential.credential) { setError('Choose your Google account to continue.'); setStatus('error'); return; }
          busy.current = true; setStatus('working'); setError(''); callbacks.current.onPendingChange?.(true);
          void fetch('/api/session?scope=customer', {
            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: mode === 'link' ? 'link-google' : 'google', tenantSlug, credential: credential.credential, nonce: config.nonce }),
          }).then(async (result) => {
            const body = await result.json() as { session?: Session; principal?: Principal; message?: string | string[] };
            if (!result.ok || !body.session || !body.principal) throw new Error([body.message ?? 'Could not sign in with Google.'].flat().join(' · '));
            if (!controller.signal.aborted) callbacks.current.onSuccess({ session: body.session, principal: body.principal });
          }).catch((cause: unknown) => {
            if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : 'Could not sign in with Google.'); setStatus('error'); }
          }).finally(() => { busy.current = false; callbacks.current.onPendingChange?.(false); });
        },
      });
      google.renderButton(element, {
        type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular',
        width: Math.max(200, Math.min(400, Math.floor(element.parentElement?.getBoundingClientRect().width || 360))), logo_alignment: 'left',
      });
      setStatus('ready');
    }
    void start().catch((cause: unknown) => {
      if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : 'Google sign-in is unavailable.'); setStatus('error'); }
    });
    return () => { controller.abort(); if (element) element.replaceChildren(); };
  }, [tenantSlug, mode, attempt]);

  return <div className="cp-google-sign-in">
    <div ref={host} className={'cp-google-button-host' + (disabled || status !== 'ready' ? ' cp-google-inactive' : '')} aria-disabled={disabled || status !== 'ready'} hidden={status !== 'ready'}/>
    {status !== 'ready' && <button type="button" className="cp-google-placeholder" disabled aria-busy={status === 'loading' || status === 'working'}><GoogleMark/><span>{status === 'working' ? (mode === 'link' ? 'Connecting Google…' : 'Signing in…') : status === 'loading' ? 'Loading Google sign-in…' : 'Continue with Google'}</span></button>}
    {status === 'disabled' && <p className="cp-google-note">Google sign-in is being set up. You can use email and password below.</p>}
    {status === 'error' && <div className="cp-google-error" role="alert"><p>{error}</p><button type="button" disabled={disabled} onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry Google sign-in</button></div>}
    {mode === 'link' && <p className="cp-google-note">Choose the Google account with the same email as your player account.</p>}
  </div>;
}

function GoogleMark() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z"/><path fill="#FBBC05" d="M10.53 28.59A14.41 14.41 0 0 1 9.75 24c0-1.59.27-3.13.78-4.59l-7.98-6.19A23.87 23.87 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/></svg>;
}
