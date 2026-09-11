import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getAccountConfig } from './config';
import {
  FREE_QUOTA_BYTES,
  type AccountSnapshot,
  type AuthActionResult,
  type CheckoutResult,
  type QuotaReservation,
  type SubscriptionStatus,
} from './types';

const AUTH_STORAGE_PREFIX = 'account:';
let client: SupabaseClient | undefined;

const extensionStorage = {
  async getItem(key: string): Promise<string | null> {
    const stored = await browser.storage.local.get(AUTH_STORAGE_PREFIX + key);
    const value = stored[AUTH_STORAGE_PREFIX + key];
    return typeof value === 'string' ? value : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await browser.storage.local.set({ [AUTH_STORAGE_PREFIX + key]: value });
  },
  async removeItem(key: string): Promise<void> {
    await browser.storage.local.remove(AUTH_STORAGE_PREFIX + key);
  },
};

function getClient(): SupabaseClient | undefined {
  const config = getAccountConfig();
  if (!config) return undefined;
  client ??= createClient(config.supabaseUrl, config.publishableKey, {
    auth: {
      storage: extensionStorage,
      storageKey: 'collection-web-pdf-auth',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function friendlyMessage(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('quota-exceeded')) return 'Agotaste los 150 MB de este ciclo. Espera la recarga o activa Premium.';
  if (normalized.includes('verified-account-required') || normalized.includes('email-not-verified')) return 'Confirma tu correo antes de capturar.';
  if (normalized.includes('monthly-subscription-already-active')) return 'Ya existe una suscripción mensual activa o pendiente.';
  if (normalized.includes('invalid login credentials')) return 'Correo o contraseña incorrectos.';
  if (normalized.includes('user already registered')) return 'Ya existe una cuenta con ese correo.';
  if (normalized.includes('failed to fetch') || normalized.includes('network')) return 'No hay conexión con el servicio de cuenta.';
  return message;
}

async function functionErrorMessage(error: unknown): Promise<string> {
  if (isRecord(error) && error.context instanceof Response) {
    const body: unknown = await error.context.clone().json().catch(() => undefined);
    if (isRecord(body) && typeof body.error === 'string') return friendlyMessage(body.error);
  }
  return friendlyMessage(isRecord(error) && typeof error.message === 'string'
    ? error.message
    : 'No se pudo contactar el servicio de cuenta.');
}

function parseSubscriptionStatus(value: unknown): SubscriptionStatus {
  const allowed: SubscriptionStatus[] = [
    'none',
    'approval-pending',
    'active',
    'past-due',
    'cancelled',
    'suspended',
    'expired',
  ];
  return allowed.includes(value as SubscriptionStatus)
    ? (value as SubscriptionStatus)
    : 'none';
}

function parseRemoteSnapshot(value: unknown): Omit<AccountSnapshot, 'configured' | 'signedIn' | 'email' | 'emailVerified'> {
  if (!isRecord(value)) throw new Error('El servidor devolvió un estado de cuenta inválido.');
  const plan = value.plan === 'premium' ? 'premium' : 'free';
  const freeBytesUsed = Number(value.freeBytesUsed ?? 0);
  const freeBytesLimit = Number(value.freeBytesLimit ?? FREE_QUOTA_BYTES);
  if (!Number.isSafeInteger(freeBytesUsed) || freeBytesUsed < 0) {
    throw new Error('El servidor devolvió un consumo inválido.');
  }
  if (!Number.isSafeInteger(freeBytesLimit) || freeBytesLimit <= 0) {
    throw new Error('El servidor devolvió un límite inválido.');
  }
  const snapshot: Omit<AccountSnapshot, 'configured' | 'signedIn' | 'email' | 'emailVerified'> = {
    plan,
    freeBytesLimit,
    freeBytesUsed,
    subscriptionStatus: parseSubscriptionStatus(value.subscriptionStatus),
    supportBenefitUsed: value.supportBenefitUsed === true,
  };
  const cycleStartedAt = optionalString(value.cycleStartedAt);
  const cycleEndsAt = optionalString(value.cycleEndsAt);
  const premiumUntil = optionalString(value.premiumUntil);
  if (cycleStartedAt) snapshot.cycleStartedAt = cycleStartedAt;
  if (cycleEndsAt) snapshot.cycleEndsAt = cycleEndsAt;
  if (premiumUntil) snapshot.premiumUntil = premiumUntil;
  return snapshot;
}

async function invoke<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const accountClient = getClient();
  if (!accountClient) throw new Error('La cuenta todavía no está configurada en este build.');
  const result = await accountClient.functions.invoke<T>('billing-api', {
    body: { action, ...payload },
  });
  if (result.error) throw new Error(await functionErrorMessage(result.error));
  if (result.data === null) throw new Error('El servicio de cuenta devolvió una respuesta vacía.');
  return result.data;
}

export async function getAccountSnapshot(): Promise<AccountSnapshot> {
  const accountClient = getClient();
  if (!accountClient) return { configured: false, signedIn: false };
  const session = await accountClient.auth.getSession();
  if (session.error) throw new Error(friendlyMessage(session.error.message));
  if (!session.data.session) return { configured: true, signedIn: false };
  const { data, error } = await accountClient.auth.getUser();
  if (error) {
    if (error.status === 401 || error.status === 403) return { configured: true, signedIn: false };
    throw new Error(friendlyMessage(error.message));
  }
  if (!data.user) return { configured: true, signedIn: false };

  const base: AccountSnapshot = {
    configured: true,
    signedIn: true,
    email: data.user.email ?? 'Cuenta sin correo',
    emailVerified: Boolean(data.user.email_confirmed_at),
  };
  if (!base.emailVerified) return base;
  return { ...base, ...parseRemoteSnapshot(await invoke<unknown>('snapshot')) };
}

export async function signUp(email: string, password: string): Promise<AuthActionResult> {
  const accountClient = getClient();
  if (!accountClient) throw new Error('La cuenta todavía no está configurada en este build.');
  const { error } = await accountClient.auth.signUp({ email: email.trim(), password });
  if (error) throw new Error(friendlyMessage(error.message));
  return {
    snapshot: await getAccountSnapshot(),
    message: 'Revisa tu correo y confirma la cuenta antes de capturar.',
  };
}

export async function signIn(email: string, password: string): Promise<AuthActionResult> {
  const accountClient = getClient();
  if (!accountClient) throw new Error('La cuenta todavía no está configurada en este build.');
  const { error } = await accountClient.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw new Error(friendlyMessage(error.message));
  return { snapshot: await getAccountSnapshot() };
}

export async function signOut(): Promise<AccountSnapshot> {
  const accountClient = getClient();
  if (accountClient) {
    const { error } = await accountClient.auth.signOut();
    if (error) throw new Error(error.message);
  }
  return { configured: Boolean(accountClient), signedIn: false };
}

export async function createCheckout(
  kind: 'premium' | 'support',
  amountCents?: number,
): Promise<CheckoutResult> {
  const result = await invoke<unknown>('create-checkout', { kind, amountCents });
  if (!isRecord(result) || typeof result.checkoutUrl !== 'string') {
    throw new Error('PayPal no devolvió un enlace de pago válido.');
  }
  return { checkoutUrl: result.checkoutUrl };
}

export async function cancelSubscription(): Promise<AccountSnapshot> {
  const snapshot = parseAuthorizedSnapshot(await invoke<unknown>('cancel-subscription'));
  const accountClient = getClient();
  const { data } = accountClient ? await accountClient.auth.getUser() : { data: { user: null } };
  if (data.user) {
    snapshot.email = data.user.email ?? 'Cuenta sin correo';
    snapshot.emailVerified = Boolean(data.user.email_confirmed_at);
  }
  return snapshot;
}

function parseAuthorizedSnapshot(value: unknown): AccountSnapshot {
  return { configured: true, signedIn: true, ...parseRemoteSnapshot(value) };
}

export async function reserveCapture(
  operationId: string,
  bytes: number,
): Promise<QuotaReservation> {
  const result = await invoke<unknown>('reserve', { operationId, bytes });
  if (
    !isRecord(result)
    || typeof result.id !== 'string'
    || typeof result.operationId !== 'string'
    || typeof result.expiresAt !== 'string'
    || Number(result.bytes) !== bytes
  ) {
    throw new Error('El servidor devolvió una reserva de cuota inválida.');
  }
  return { id: result.id, operationId: result.operationId, bytes, expiresAt: result.expiresAt };
}

export async function commitCapture(reservationId: string): Promise<AccountSnapshot> {
  return parseAuthorizedSnapshot(await invoke<unknown>('commit', { reservationId }));
}

export async function cancelCaptureReservation(reservationId: string): Promise<void> {
  await invoke<unknown>('cancel-reservation', { reservationId });
}

export async function reconcileCaptureReservation(reservationId: string): Promise<AccountSnapshot> {
  return parseAuthorizedSnapshot(await invoke<unknown>('reconcile', { reservationId }));
}

export async function requireCaptureAccess(): Promise<AccountSnapshot> {
  const snapshot = await getAccountSnapshot();
  if (!snapshot.configured) throw new Error('Configura el servicio de cuenta antes de capturar.');
  if (!snapshot.signedIn) throw new Error('Inicia sesión para capturar nuevas vistas.');
  if (!snapshot.emailVerified) throw new Error('Confirma tu correo antes de capturar.');
  if (snapshot.plan !== 'premium' && (snapshot.freeBytesUsed ?? 0) >= (snapshot.freeBytesLimit ?? FREE_QUOTA_BYTES)) {
    throw new Error('Agotaste los 150 MB de este ciclo. Espera la recarga o activa Premium.');
  }
  return snapshot;
}

export async function protectAccountStorage(): Promise<void> {
  const storage = browser.storage.local as unknown as {
    setAccessLevel?: (options: { accessLevel: 'TRUSTED_CONTEXTS' }) => Promise<void>;
  };
  await storage.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
}
