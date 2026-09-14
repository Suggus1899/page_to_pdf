import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PRINT_SETTINGS,
  type CapturePayload,
  type CollectionDraft,
} from '../src/domain/types';
import type { RuntimeMessage, RuntimeResponse } from '../src/runtime/messages';

const mocks = vi.hoisted(() => ({
  addCapture: vi.fn(),
  cancelCaptureReservation: vi.fn(),
  captureBytes: vi.fn(),
  captureTabAsPdf: vi.fn(),
  commitCapture: vi.fn(),
  ensureDefaultCollection: vi.fn(),
  getCollection: vi.fn(),
  hasDebuggerPermission: vi.fn(),
  listPendingCaptureItems: vi.fn(),
  markCaptureReady: vi.fn(),
  protectAccountStorage: vi.fn(),
  requireCaptureAccess: vi.fn(),
  reserveCapture: vi.fn(),
}));

vi.mock('../src/account/gateway', () => ({
  cancelCaptureReservation: mocks.cancelCaptureReservation,
  cancelSubscription: vi.fn(),
  commitCapture: mocks.commitCapture,
  createCheckout: vi.fn(),
  getAccountSnapshot: vi.fn(),
  protectAccountStorage: mocks.protectAccountStorage,
  reconcileCaptureReservation: vi.fn(),
  requireCaptureAccess: mocks.requireCaptureAccess,
  reserveCapture: mocks.reserveCapture,
  signIn: vi.fn(),
  signOut: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock('../src/pdf/chromium', () => ({
  captureTabAsPdf: mocks.captureTabAsPdf,
  hasDebuggerPermission: mocks.hasDebuggerPermission,
}));

vi.mock('../src/storage/database', () => ({
  addCapture: mocks.addCapture,
  captureBytes: mocks.captureBytes,
  ensureDefaultCollection: mocks.ensureDefaultCollection,
  getCollection: mocks.getCollection,
  listPendingCaptureItems: mocks.listPendingCaptureItems,
  markCaptureReady: mocks.markCaptureReady,
}));

const collection: CollectionDraft = {
  id: 'collection-1',
  name: 'Visual',
  createdAt: '2026-09-09T12:00:00.000Z',
  updatedAt: '2026-09-09T12:00:00.000Z',
  itemCount: 0,
  bytesUsed: 0,
  status: 'ready',
  captureFaithful: false,
  printSettings: DEFAULT_PRINT_SETTINGS,
};

const payload: CapturePayload = {
  title: 'Estado SPA',
  url: 'https://example.test/app',
  capturedAt: '2026-09-09T12:00:00.000Z',
  viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
  scope: { kind: 'selection', included: ['main'], excluded: [] },
  warnings: [],
  document: {
    schemaVersion: 1,
    title: 'Estado SPA',
    url: 'https://example.test/app',
    capturedAt: '2026-09-09T12:00:00.000Z',
    language: 'es',
    blocks: [{ type: 'paragraph', text: 'Contenido', links: [] }],
  },
};

type RuntimeListener = (
  message: unknown,
  sender: Browser.runtime.MessageSender,
  sendResponse: (response: RuntimeResponse) => void,
) => boolean | undefined;

describe('coordinador de captura visual', () => {
  let runtimeListener: RuntimeListener | undefined;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    runtimeListener = undefined;
    mocks.getCollection.mockResolvedValue(collection);
    mocks.hasDebuggerPermission.mockResolvedValue(true);
    mocks.captureTabAsPdf.mockResolvedValue(new ArrayBuffer(12));
    mocks.captureBytes.mockReturnValue(12);
    mocks.reserveCapture.mockResolvedValue({ id: 'reservation-1' });
    mocks.addCapture.mockResolvedValue({ id: 'item-1', status: 'quota-pending' });
    mocks.markCaptureReady.mockResolvedValue({ id: 'item-1', status: 'ready' });
    mocks.listPendingCaptureItems.mockResolvedValue([]);

    vi.stubGlobal('defineBackground', (setup: () => void) => setup());
    vi.stubGlobal('browser', {
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onMessage: {
          addListener: vi.fn((listener: RuntimeListener) => {
            runtimeListener = listener;
          }),
        },
      },
      action: {
        setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
        setBadgeText: vi.fn().mockResolvedValue(undefined),
      },
      tabs: {},
      scripting: {},
    });

    await import('../entrypoints/background');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function dispatch(message: RuntimeMessage): Promise<RuntimeResponse> {
    if (!runtimeListener) throw new Error('El listener de fondo no fue registrado.');
    return new Promise((resolve) => {
      const sender = { tab: { id: 21 } as Browser.tabs.Tab } as Browser.runtime.MessageSender;
      expect(runtimeListener?.(message, sender, resolve)).toBe(true);
    });
  }

  it('no crea artefactos parciales cuando el permiso se pierde', async () => {
    mocks.hasDebuggerPermission.mockResolvedValue(false);

    const response = await dispatch({
      version: 2,
      type: 'capture/selection-ready',
      collectionId: collection.id,
      faithful: true,
      payload,
    });

    expect(response.ok).toBe(false);
    expect(response.error).toContain('Se perdió el permiso');
    expect(mocks.captureTabAsPdf).not.toHaveBeenCalled();
    expect(mocks.addCapture).not.toHaveBeenCalled();
  });

  it('exige el PDF visual aunque reciba un mensaje interno antiguo', async () => {
    const visualPdf = new ArrayBuffer(12);
    mocks.captureTabAsPdf.mockResolvedValue(visualPdf);

    const response = await dispatch({
      version: 2,
      type: 'capture/selection-ready',
      collectionId: collection.id,
      faithful: false,
      payload,
    });

    expect(response.ok).toBe(true);
    expect(mocks.captureTabAsPdf).toHaveBeenCalledWith(21, DEFAULT_PRINT_SETTINGS);
    expect(mocks.reserveCapture).toHaveBeenCalledWith(expect.any(String), 12);
    expect(mocks.addCapture).toHaveBeenCalledWith(
      collection.id,
      payload,
      visualPdf,
      expect.objectContaining({ reservationId: 'reservation-1' }),
    );
    expect(mocks.commitCapture).toHaveBeenCalledWith('reservation-1');
    expect(mocks.markCaptureReady).toHaveBeenCalledWith('item-1');
  });

  it('no guarda la captura cuando el servidor rechaza la cuota', async () => {
    mocks.reserveCapture.mockRejectedValue(new Error('quota-exceeded'));
    const response = await dispatch({
      version: 2,
      type: 'capture/selection-ready',
      collectionId: collection.id,
      faithful: true,
      payload,
    });

    expect(response.ok).toBe(false);
    expect(mocks.addCapture).not.toHaveBeenCalled();
  });

  it('conserva la vista pendiente si se corta la confirmación', async () => {
    mocks.commitCapture.mockRejectedValue(new Error('sin conexión'));
    const response = await dispatch({
      version: 2,
      type: 'capture/selection-ready',
      collectionId: collection.id,
      faithful: true,
      payload,
    });

    expect(response.ok).toBe(false);
    expect(response.error).toContain('pendiente');
    expect(mocks.addCapture).toHaveBeenCalledWith(
      collection.id,
      payload,
      expect.any(ArrayBuffer),
      expect.objectContaining({ reservationId: 'reservation-1' }),
    );
    expect(mocks.markCaptureReady).not.toHaveBeenCalled();
    expect(mocks.cancelCaptureReservation).not.toHaveBeenCalled();
  });
});
