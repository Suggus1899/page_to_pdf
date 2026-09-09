import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PopupApp } from '../entrypoints/popup/PopupApp';
import { clearAllData, listCaptureItems, listCollections } from '../src/storage/database';

describe('popup', () => {
  const permissionRequest = vi.fn();
  const permissionContains = vi.fn();
  const sendMessage = vi.fn();

  beforeEach(async () => {
    await clearAllData();
    permissionRequest.mockReset();
    permissionContains.mockReset();
    sendMessage.mockReset();
    permissionContains.mockResolvedValue(false);
    permissionRequest.mockResolvedValue(false);
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
    vi.stubGlobal('chrome', {
      permissions: { contains: permissionContains, request: permissionRequest },
    });
  });

  async function renderReadyPopup() {
    const user = userEvent.setup();
    render(<PopupApp />);
    const captureButton = await screen.findByRole('button', { name: 'Capturar web completa' });
    await waitFor(() => expect(captureButton).toBeEnabled());
    expect(screen.getByRole('combobox')).toHaveTextContent('Mi primera colección');
    return { user, captureButton };
  }

  it('cancela sin guardar ni enviar mensajes cuando se deniega debugger', async () => {
    const { user, captureButton } = await renderReadyPopup();

    await user.click(captureButton);

    expect(permissionRequest).toHaveBeenCalledWith({ permissions: ['debugger'] });
    expect(await screen.findByRole('alert')).toHaveTextContent('No se guardó la vista');
    expect(sendMessage).not.toHaveBeenCalled();
    const [collection] = await listCollections();
    expect(collection).toBeDefined();
    expect(await listCaptureItems(collection!.id)).toHaveLength(0);
  });

  it('solicita el permiso y siempre inicia una captura visual', async () => {
    permissionRequest.mockResolvedValue(true);
    const { user, captureButton } = await renderReadyPopup();

    await user.click(captureButton);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'capture/full', faithful: true }),
    ));
    expect(permissionRequest).toHaveBeenCalledOnce();
  });

  it('reutiliza el permiso concedido sin mostrar otra solicitud', async () => {
    permissionContains.mockResolvedValue(true);
    const { user, captureButton } = await renderReadyPopup();

    await user.click(captureButton);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'capture/full', faithful: true }),
    ));
    expect(permissionRequest).not.toHaveBeenCalled();
  });
});
