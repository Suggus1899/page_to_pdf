import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountPanel } from '../src/account/AccountPanel';

describe('cuenta y plan', () => {
  const sendMessage = vi.fn();

  beforeEach(() => {
    sendMessage.mockReset();
    vi.stubGlobal('browser', { runtime: { sendMessage } });
  });

  it('muestra la cuota gratuita y abre el checkout Premium', async () => {
    sendMessage.mockImplementation((message: { type: string }) => Promise.resolve(
      message.type === 'account/snapshot'
        ? {
            ok: true,
            data: {
              configured: true,
              signedIn: true,
              email: 'persona@example.com',
              emailVerified: true,
              plan: 'free',
              freeBytesLimit: 150 * 1024 * 1024,
              freeBytesUsed: 10 * 1024 * 1024,
              subscriptionStatus: 'none',
              supportBenefitUsed: false,
            },
          }
        : { ok: true, data: { opened: true } },
    ));
    const user = userEvent.setup();
    render(<AccountPanel />);

    expect(await screen.findByText('10.0 MB de 150.0 MB')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Premium · $2.49/mes' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'billing/checkout', kind: 'premium' }),
    ));
    expect(screen.getByText(/PayPal se abrió/)).toBeVisible();
  });

  it('ofrece un formulario de cuenta accesible', async () => {
    sendMessage.mockResolvedValue({ ok: true, data: { configured: true, signedIn: false } });
    const user = userEvent.setup();
    render(<AccountPanel compact />);

    const email = await screen.findByRole('textbox', { name: 'Correo' });
    expect(email).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute('autocomplete', 'current-password');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute('autocomplete', 'new-password');
  });
});
