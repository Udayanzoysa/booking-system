export function frontendCors(): { origin: string[] } {
  const origin = process.env.FRONTEND_ORIGIN;
  if (!origin) return { origin: [] };

  const parsed = new URL(origin);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
    throw new Error('FRONTEND_ORIGIN must be an HTTP or HTTPS origin without a trailing slash');
  }
  return { origin: [origin] };
}
