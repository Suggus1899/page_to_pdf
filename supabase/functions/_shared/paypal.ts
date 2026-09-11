import { requiredEnv } from './http.ts';

export interface PayPalLink {
  href: string;
  rel: string;
}

let token: { value: string; expiresAt: number } | undefined;

function baseUrl(): string {
  return Deno.env.get('PAYPAL_ENV') === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

async function accessToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 30_000) return token.value;
  const credentials = btoa(`${requiredEnv('PAYPAL_CLIENT_ID')}:${requiredEnv('PAYPAL_CLIENT_SECRET')}`);
  const response = await fetch(`${baseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) throw new Error(`PayPal OAuth failed (${response.status})`);
  const body = await response.json() as { access_token?: unknown; expires_in?: unknown };
  if (typeof body.access_token !== 'string') throw new Error('PayPal returned no access token');
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 300;
  token = { value: body.access_token, expiresAt: Date.now() + expiresIn * 1000 };
  return token.value;
}

export async function paypalRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(baseUrl() + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': crypto.randomUUID(),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`PayPal request failed (${response.status}): ${detail}`);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

export function approvalUrl(links: PayPalLink[] | undefined): string {
  const url = links?.find((link) => link.rel === 'approve' || link.rel === 'payer-action')?.href;
  if (!url || !url.startsWith('https://')) throw new Error('PayPal returned no approval URL');
  return url;
}
