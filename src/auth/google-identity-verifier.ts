import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { isEmail } from 'class-validator';
import { OAuth2Client } from 'google-auth-library';

export type GoogleIdentity = { subject: string; email: string; displayName: string };

export function googleClientId(): string | null {
  const value = process.env.GOOGLE_CLIENT_ID?.trim();
  return value && /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value) ? value : null;
}

@Injectable()
export class GoogleIdentityVerifier {
  private readonly client = new OAuth2Client({ transporterOptions: { timeout: 8_000, retry: false } });

  async verify(credential: string, nonce: string): Promise<GoogleIdentity> {
    const audience = googleClientId();
    if (!audience) throw new ServiceUnavailableException('Google sign-in is not configured for this site yet.');
    if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) {
      throw new UnauthorizedException('Google sign-in has expired. Try signing in again.');
    }
    try {
      // Google's library verifies the RSA signature, issuer, audience, and token lifetime.
      const ticket = await this.client.verifyIdToken({ idToken: credential, audience });
      const payload = ticket.getPayload();
      const returnedNonce: unknown = payload && 'nonce' in payload ? payload.nonce : undefined;
      if (!payload || !['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)
        || payload.aud !== audience || !Number.isSafeInteger(payload.exp) || payload.exp * 1000 <= Date.now()
        || payload.email_verified !== true || typeof payload.email !== 'string'
        || payload.email.length > 254 || !isEmail(payload.email)
        || typeof payload.sub !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(payload.sub)
        || returnedNonce !== nonce) {
        throw new Error('Invalid Google identity');
      }
      const email = payload.email.trim().toLowerCase();
      const displayName = (typeof payload.name === 'string' ? payload.name.trim() : '') || email.split('@')[0];
      return { subject: payload.sub, email, displayName: displayName.slice(0, 120) };
    } catch {
      throw new UnauthorizedException('Google sign-in could not be verified. Try signing in again.');
    }
  }
}
