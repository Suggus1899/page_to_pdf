import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PopupApp } from '../entrypoints/popup/PopupApp';
import { clearAllData } from '../src/storage/database';

describe('popup', () => {
  const permissionRequest = vi.fn();

  beforeEach(async () => {
    await clearAllData();
    permissionRequest.mockReset();
    permissionRequest.mockResolvedValue(false);
    vi.stubGlobal('browser', {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ ok: true }),
        getURL: (path: string) => 'chrome-extension://test' + path,
      },
      tabs: { create: vi.fn().mockResolvedValue(undefined) },
    });
    vi.stubGlobal('chrome', {
      permissions: { request: permissionRequest },
    });
  });

  it('crea la colección inicial y mantiene Lectura IA si se deniega debugger', async () => {
    const user = userEvent.setup();
    render(<PopupApp />);

    const captureButton = await screen.findByRole('button', { name: 'Añadir página completa' });
    await waitFor(() => expect(captureButton).toBeEnabled());
    expect(screen.getByRole('combobox')).toHaveTextContent('Mi primera colección');

    await user.click(screen.getByRole('checkbox', { name: /Guardar también versión fiel/i }));
    expect(permissionRequest).toHaveBeenCalledWith({ permissions: ['debugger'] });
    expect(await screen.findByRole('alert')).toHaveTextContent('El modo legible continúa disponible');
    await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked());
  });
});
