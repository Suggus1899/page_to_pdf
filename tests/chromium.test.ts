import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureTabAsPdf, hasDebuggerPermission } from '../src/pdf/chromium';
import { DEFAULT_PRINT_SETTINGS } from '../src/domain/types';

describe('adaptador PDF de Chromium', () => {
  const attach = vi.fn();
  const detach = vi.fn();
  const sendCommand = vi.fn();
  const contains = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    contains.mockResolvedValue(true);
    attach.mockResolvedValue(undefined);
    detach.mockResolvedValue(undefined);
    sendCommand.mockImplementation((_target: unknown, method: string) => {
      if (method === 'Page.getLayoutMetrics') {
        return Promise.resolve({ cssLayoutViewport: { clientWidth: 1366 } });
      }
      return Promise.resolve(method === 'Page.printToPDF' ? { data: btoa('%PDF-prueba') } : {});
    });
    vi.stubGlobal('chrome', {
      permissions: { contains },
      debugger: { attach, detach, sendCommand },
    });
  });

  it('detecta el permiso requerido antes de usar el depurador', async () => {
    expect(await hasDebuggerPermission()).toBe(true);
    expect(contains).toHaveBeenCalledWith({ permissions: ['debugger'] });
  });

  it('imprime con CDP y desconecta el depurador', async () => {
    const bytes = await captureTabAsPdf(12, DEFAULT_PRINT_SETTINGS);
    expect(new TextDecoder().decode(bytes)).toBe('%PDF-prueba');
    expect(attach).toHaveBeenCalledWith({ tabId: 12 }, '1.3');
    expect(sendCommand).toHaveBeenNthCalledWith(3, { tabId: 12 }, 'Page.getLayoutMetrics');
    expect(sendCommand).toHaveBeenCalledWith(
      { tabId: 12 },
      'Page.printToPDF',
      expect.objectContaining({
        paperWidth: 8.5,
        paperHeight: 11,
        landscape: false,
        printBackground: true,
        scale: 720 / 1366,
        marginTop: 0.5,
        marginBottom: 0.5,
        marginLeft: 0.5,
        marginRight: 0.5,
        preferCSSPageSize: false,
        transferMode: 'ReturnAsBase64',
      }),
    );
    expect(detach).toHaveBeenCalledWith({ tabId: 12 });
  });

  it('no amplía una vista más estrecha que el área imprimible', async () => {
    sendCommand.mockImplementation((_target: unknown, method: string) => {
      if (method === 'Page.getLayoutMetrics') {
        return Promise.resolve({ cssLayoutViewport: { clientWidth: 640 } });
      }
      return Promise.resolve(method === 'Page.printToPDF' ? { data: btoa('%PDF-prueba') } : {});
    });

    await captureTabAsPdf(12, DEFAULT_PRINT_SETTINGS);

    expect(sendCommand).toHaveBeenCalledWith(
      { tabId: 12 },
      'Page.printToPDF',
      expect.objectContaining({ scale: 1 }),
    );
  });

  it('considera orientación y escala elegida al ajustar el ancho', async () => {
    await captureTabAsPdf(12, {
      ...DEFAULT_PRINT_SETTINGS,
      orientation: 'landscape',
      scale: 1.25,
    });

    expect(sendCommand).toHaveBeenCalledWith(
      { tabId: 12 },
      'Page.printToPDF',
      expect.objectContaining({
        landscape: true,
        scale: 1.25 * 960 / 1366,
      }),
    );
  });

  it('también desconecta si la impresión falla', async () => {
    sendCommand.mockImplementation((_target: unknown, method: string) => {
      if (method === 'Page.printToPDF') return Promise.reject(new Error('Target closed'));
      return Promise.resolve({});
    });

    await expect(captureTabAsPdf(12, DEFAULT_PRINT_SETTINGS)).rejects.toThrow('Target closed');
    expect(detach).toHaveBeenCalledWith({ tabId: 12 });
  });

  it('cancela el PDF visual antes de conectar si se pierde el permiso', async () => {
    contains.mockResolvedValue(false);
    await expect(captureTabAsPdf(12, DEFAULT_PRINT_SETTINGS)).rejects.toThrow('permiso de captura');
    expect(attach).not.toHaveBeenCalled();
  });
});
