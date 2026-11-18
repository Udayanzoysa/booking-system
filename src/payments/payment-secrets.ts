import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';

function encryptionKey(): Buffer | null {
  const value = process.env.PAYMENT_SETTINGS_ENCRYPTION_KEY?.trim();
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return null;
  const key = Buffer.from(value, 'base64');
  return key.length === 32 ? key : null;
}

export const paymentEncryptionAvailable = () => Boolean(encryptionKey());

export function encryptPaymentSecret(tenantId: string, secret: string): string {
  const key = encryptionKey();
  if (!key) throw new ServiceUnavailableException('Payment credential encryption is not configured on this server.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('payhere:' + tenantId, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
}

export function decryptPaymentSecret(tenantId: string, value: string): string {
  const key = encryptionKey();
  if (!key) throw new ServiceUnavailableException('Payment credential encryption is not configured on this server.');
  try {
    const [version, iv, tag, encrypted, extra] = value.split('.');
    if (version !== 'v1' || !iv || !tag || !encrypted || extra !== undefined) throw new Error();
    const nonce = Buffer.from(iv, 'base64');
    const authTag = Buffer.from(tag, 'base64');
    if (nonce.length !== 12 || authTag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(Buffer.from('payhere:' + tenantId, 'utf8'));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new ServiceUnavailableException('Saved payment credentials could not be opened. Ask an administrator to save them again.');
  }
}
