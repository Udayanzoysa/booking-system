const configuredOrigin = process.env.NEXT_PUBLIC_BOOKING_API_ORIGIN ?? 'http://localhost:3000';
export const apiOrigin = configuredOrigin.replace(/\/$/, '');

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, token?: string | null, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', 'Bearer ' + token);
  let response: Response;
  try {
    response = await fetch(apiOrigin + '/api' + path, { ...options, headers });
  } catch (error) {
    if (options?.signal?.aborted) throw error;
    throw new ApiError(0, 'Could not reach the booking API. Check that the backend is running and allows this site origin.');
  }
  if (!response.ok) {
    const body: { message?: string | string[] } | null = await response.json().catch(() => null);
    throw new ApiError(response.status, [body?.message ?? 'Request failed'].flat().join(' · '));
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function json(method: string, body?: unknown): RequestInit {
  return { method, body: body === undefined ? undefined : JSON.stringify(body) };
}
