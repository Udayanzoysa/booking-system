import { createHash, timingSafeEqual } from 'node:crypto';

const md5 = (value: string) => createHash('md5').update(value).digest('hex').toUpperCase();

// PayHere's Checkout API requires these exact uppercase MD5 constructions.
// The merchant secret is never returned to the client or stored with checkout data.
export function checkoutHash(merchantId: string, orderId: string, amount: string, currency: string, secret: string) {
  return md5(merchantId + orderId + amount + currency + md5(secret));
}

export function validNotificationSignature(fields: Record<string, string>, secret: string): boolean {
  if (!/^[a-f\d]{32}$/i.test(fields.md5sig)) return false;
  const expected = md5(fields.merchant_id + fields.order_id + fields.payhere_amount
    + fields.payhere_currency + fields.status_code + md5(secret));
  return timingSafeEqual(Buffer.from(expected, 'ascii'), Buffer.from(fields.md5sig.toUpperCase(), 'ascii'));
}

export function safeAttachment(file: { buffer: Buffer; mimetype: string }): string | null {
  if (file.mimetype === 'image/png' && file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (file.mimetype === 'image/jpeg' && file.buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg';
  if (file.mimetype === 'application/pdf' && file.buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
}
