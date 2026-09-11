import { useCallback, useEffect, useState } from 'react';
import {
  FREE_QUOTA_BYTES,
  MIN_SUPPORT_USD,
  PREMIUM_PRICE_USD,
  type AccountSnapshot,
  type AuthActionResult,
} from './types';
import {
  MESSAGE_PROTOCOL_VERSION,
  type RuntimeMessage,
  type RuntimeResponse,
} from '../runtime/messages';
import { formatBytes } from '../utils/filename';

interface AccountPanelProps {
  compact?: boolean;
  refreshToken?: number;
  onSnapshot?: (snapshot: AccountSnapshot) => void;
}

async function send<T>(message: RuntimeMessage): Promise<T> {
  const response: RuntimeResponse<T> = await browser.runtime.sendMessage(message);
  if (!response.ok || response.data === undefined) {
    throw new Error(response.error || 'No se pudo completar la acción de cuenta.');
  }
  return response.data;
}

export function AccountPanel({ compact = false, refreshToken = 0, onSnapshot }: AccountPanelProps) {
  const [snapshot, setSnapshot] = useState<AccountSnapshot>();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [supportAmount, setSupportAmount] = useState(MIN_SUPPORT_USD);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean }>();

  const applySnapshot = useCallback((next: AccountSnapshot): void => {
    setSnapshot(next);
    onSnapshot?.(next);
  }, [onSnapshot]);

  const refresh = useCallback(async (): Promise<void> => {
    applySnapshot(await send<AccountSnapshot>({
      version: MESSAGE_PROTOCOL_VERSION,
      type: 'account/snapshot',
    }));
  }, [applySnapshot]);

  useEffect(() => {
    void refresh().catch((error: unknown) => {
      setNotice({ text: error instanceof Error ? error.message : 'No se pudo cargar la cuenta.', error: true });
    });
  }, [refresh, refreshToken]);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setNotice(undefined);
    try {
      await action();
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : 'No se pudo completar la acción.', error: true });
    } finally {
      setBusy(false);
    }
  };

  const authenticate = async (): Promise<void> => {
    const result = await send<AuthActionResult>({
      version: MESSAGE_PROTOCOL_VERSION,
      type: mode === 'signin' ? 'account/sign-in' : 'account/sign-up',
      email,
      password,
    });
    setPassword('');
    applySnapshot(result.snapshot);
    if (result.message) setNotice({ text: result.message, error: false });
  };

  const checkout = async (kind: 'premium' | 'support'): Promise<void> => {
    await send<{ opened: true }>({
      version: MESSAGE_PROTOCOL_VERSION,
      type: 'billing/checkout',
      kind,
      ...(kind === 'support' ? { amountCents: Math.round(supportAmount * 100) } : {}),
    });
    setNotice({ text: 'PayPal se abrió en una pestaña nueva. Actualiza la cuenta después del pago.', error: false });
  };

  if (!snapshot) {
    return <section className={'account-panel ' + (compact ? 'compact' : '')} aria-busy="true">Cargando cuenta…</section>;
  }

  if (!snapshot.configured) {
    return (
      <section className={'account-panel warning ' + (compact ? 'compact' : '')}>
        <strong>Cuenta pendiente de configuración</strong>
        <span>Agrega las variables públicas de Supabase para habilitar capturas.</span>
      </section>
    );
  }

  if (!snapshot.signedIn) {
    return (
      <section className={'account-panel ' + (compact ? 'compact' : '')} aria-label="Cuenta">
        <div className="account-heading">
          <div><strong>{mode === 'signin' ? 'Inicia sesión' : 'Crea tu cuenta'}</strong><span>150 MB cada 15 días</span></div>
          <button className="text-button" type="button" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
            {mode === 'signin' ? 'Crear cuenta' : 'Ya tengo cuenta'}
          </button>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); void run(authenticate); }}>
          <label className="sr-only" htmlFor={'account-email-' + (compact ? 'popup' : 'manager')}>Correo</label>
          <input
            id={'account-email-' + (compact ? 'popup' : 'manager')}
            type="email"
            autoComplete="email"
            placeholder="correo@ejemplo.com"
            value={email}
            required
            onChange={(event) => setEmail(event.target.value)}
          />
          <label className="sr-only" htmlFor={'account-password-' + (compact ? 'popup' : 'manager')}>Contraseña</label>
          <input
            id={'account-password-' + (compact ? 'popup' : 'manager')}
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            placeholder="Contraseña"
            minLength={8}
            value={password}
            required
            onChange={(event) => setPassword(event.target.value)}
          />
          <button className="button primary" type="submit" disabled={busy}>
            {mode === 'signin' ? 'Iniciar sesión' : 'Crear cuenta'}
          </button>
        </form>
        {notice ? <div className={notice.error ? 'error' : 'success'} role={notice.error ? 'alert' : 'status'}>{notice.text}</div> : null}
      </section>
    );
  }

  const used = snapshot.freeBytesUsed ?? 0;
  const limit = snapshot.freeBytesLimit ?? FREE_QUOTA_BYTES;
  const percent = snapshot.plan === 'premium' ? 0 : Math.min(100, used / limit * 100);
  const subscriptionActive = ['active', 'approval-pending', 'past-due'].includes(snapshot.subscriptionStatus ?? 'none');
  const billingActions = snapshot.emailVerified ? (
    <div className="billing-actions">
      {snapshot.plan !== 'premium' && !subscriptionActive ? (
        <button className="button primary" disabled={busy} onClick={() => void run(() => checkout('premium'))}>
          Premium · ${PREMIUM_PRICE_USD.toFixed(2)}/mes
        </button>
      ) : null}
      {subscriptionActive ? (
        <button className="button danger-ghost" disabled={busy} onClick={() => void run(async () => {
          applySnapshot(await send<AccountSnapshot>({ version: MESSAGE_PROTOCOL_VERSION, type: 'billing/cancel-subscription' }));
          setNotice({ text: 'La renovación fue cancelada. Conservas Premium hasta el fin del período pagado.', error: false });
        })}>Cancelar renovación</button>
      ) : (
        <div className="support-row">
          <label>
            <span>Apoyar el proyecto</span>
            <span className="support-input"><span>$</span><input type="number" min={MIN_SUPPORT_USD} step="1" value={supportAmount} onChange={(event) => setSupportAmount(Number(event.target.value))} /></span>
          </label>
          <button className="button" disabled={busy || supportAmount < MIN_SUPPORT_USD} onClick={() => void run(() => checkout('support'))}>Ir a PayPal</button>
        </div>
      )}
      {!subscriptionActive ? <small className="support-copy">{snapshot.supportBenefitUsed ? 'Tu beneficio inicial de apoyo ya fue usado; los nuevos aportes no añaden Premium.' : 'El primer apoyo de $4 o más incluye 3 meses de Premium.'}</small> : null}
    </div>
  ) : null;

  return (
    <section className={'account-panel ' + (compact ? 'compact' : '')} aria-label="Cuenta y plan">
      <div className="account-heading">
        <div><strong>{snapshot.plan === 'premium' ? 'Premium' : 'Plan gratuito'}</strong><span>{snapshot.email}</span></div>
        <button className="text-button" type="button" disabled={busy} onClick={() => void run(async () => {
          applySnapshot(await send<AccountSnapshot>({ version: MESSAGE_PROTOCOL_VERSION, type: 'account/sign-out' }));
        })}>Salir</button>
      </div>

      {!snapshot.emailVerified ? (
        <div className="warning" role="status">Confirma tu correo para empezar a capturar.</div>
      ) : snapshot.plan === 'premium' ? (
        <div className="plan-summary premium-summary"><strong>Capturas ilimitadas</strong><span>El límite local sigue siendo 300 MB por colección.</span></div>
      ) : (
        <div className="quota-summary" aria-live="polite">
          <div><strong>{formatBytes(used)} de {formatBytes(limit)}</strong><span>{snapshot.cycleEndsAt ? 'Se recarga el ' + new Date(snapshot.cycleEndsAt).toLocaleString('es-VE') : 'El ciclo inicia con tu primera captura'}</span></div>
          <span className="usage-track" aria-hidden="true"><span style={{ width: percent + '%' }} /></span>
        </div>
      )}

      {compact && billingActions ? (
        <details className="billing-details">
          <summary>Premium y apoyo</summary>
          {billingActions}
        </details>
      ) : billingActions}

      <button className="text-button refresh-account" type="button" disabled={busy} onClick={() => void run(refresh)}>Actualizar cuenta</button>
      {notice ? <div className={notice.error ? 'error' : 'success'} role={notice.error ? 'alert' : 'status'}>{notice.text}</div> : null}
    </section>
  );
}
