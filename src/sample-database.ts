export function isSampleDatabase(): boolean {
  const value = process.env.DATABASE_URL;
  const url = value && URL.canParse(value) ? new URL(value) : null;
  return Boolean(url && ['postgresql:', 'postgres:'].includes(url.protocol)
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    && url.pathname === '/techwing_auth_sample');
}

export function requireSampleDatabase(): void {
  if (!isSampleDatabase()) {
    throw new Error('Use the local techwing_auth_sample PostgreSQL database for sample data.');
  }
}
