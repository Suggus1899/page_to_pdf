import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PopupApp } from '../entrypoints/popup/PopupApp';
import { clearAllData, getCollection } from '../src/storage/database';

describe('popup', () => {
  const sendMessage = vi.fn();

  beforeEach(async () => {
    await clearAllData();
    sendMessage.mockReset();
    sendMessage.mockResolvedValue({ ok: true });
    vi.stubGlobal('browser', {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
      runtime: {
        sendMessage,
        getURL: (path: string) => 'chrome-extension://test' + path,
      },
      tabs: { create: vi.fn().mockResolvedValue(undefined) },
    });
  });

  async function renderReadyPopup() {
    const user = userEvent.setup();
    render(<PopupApp />);
    const captureButton = await screen.findByRole('button', { name: 'Capturar web completa' });
    await waitFor(() => expect(captureButton).toBeEnabled());
    expect(screen.getByRole('combobox', { name: 'Colección activa' })).toHaveTextContent(
      'Mi primera colección',
    );
    return { user, captureButton };
  }

  it('inicia directamente una captura visual con el permiso del manifiesto', async () => {
    const { user, captureButton } = await renderReadyPopup();

    await user.click(captureButton);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'capture/full', faithful: true }),
    ));
    expect(screen.getByText(/permiso avanzado aceptado al cargar la extensión/i)).toBeVisible();
  });

  it('permite ajustar el PDF de la colección activa', async () => {
    const { user } = await renderReadyPopup();

    await user.click(screen.getByText('Opciones del PDF'));
    await user.selectOptions(screen.getByLabelText('Papel'), 'a4');
    await waitFor(async () => {
      expect((await getCollection('default'))?.printSettings.paper).toBe('a4');
    });

    await user.selectOptions(screen.getByLabelText('Orientación'), 'landscape');
    await waitFor(async () => {
      expect((await getCollection('default'))?.printSettings.orientation).toBe('landscape');
    });
  });
});
