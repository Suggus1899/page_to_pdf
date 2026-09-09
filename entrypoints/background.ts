import type { CapturePayload, CollectionDraft } from '../src/domain/types';
import { captureTabAsPdf, hasDebuggerPermission } from '../src/pdf/chromium';
import {
  isRuntimeMessage,
  MESSAGE_PROTOCOL_VERSION,
  type RuntimeMessage,
  type RuntimeResponse,
} from '../src/runtime/messages';
import { addCapture, ensureDefaultCollection, getCollection } from '../src/storage/database';

function assertInjectable(tab: Browser.tabs.Tab): asserts tab is Browser.tabs.Tab & { id: number; url: string } {
  if (tab.id === undefined || !tab.url || !/^(https?|file):/i.test(tab.url)) {
    throw new Error('Esta página está protegida por el navegador y no puede capturarse.');
  }
}

async function activeTab(): Promise<Browser.tabs.Tab & { id: number; url: string }> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No se encontró una pestaña activa.');
  assertInjectable(tab);
  return tab;
}

async function injectCaptureRuntime(tabId: number): Promise<void> {
  await browser.scripting.executeScript({
    target: { tabId },
    files: ['/capture.js'],
  });
}

async function captureVisualPdf(
  tabId: number,
  collection: CollectionDraft,
): Promise<ArrayBuffer> {
  if (!(await hasDebuggerPermission())) {
    throw new Error(
      'Se perdió el permiso de captura visual. Vuelve a iniciar la captura y concédelo nuevamente.',
    );
  }
  return captureTabAsPdf(tabId, collection.printSettings);
}

async function storeCapture(
  tabId: number,
  collectionId: string,
  payload: CapturePayload,
): Promise<RuntimeResponse> {
  const collection = await getCollection(collectionId);
  if (!collection) return { ok: false, error: 'La colección ya no existe.' };
  const faithfulPdf = await captureVisualPdf(tabId, collection);
  const item = await addCapture(collectionId, payload, faithfulPdf);
  await browser.action.setBadgeBackgroundColor({ color: '#16a34a', tabId });
  await browser.action.setBadgeText({ text: '✓', tabId });
  setTimeout(() => void browser.action.setBadgeText({ text: '', tabId }), 2500);
  return { ok: true, data: item };
}

async function handleFullCapture(
  message: Extract<RuntimeMessage, { type: 'capture/full' }>,
): Promise<RuntimeResponse> {
  const tab = await activeTab();
  await injectCaptureRuntime(tab.id);
  const response: RuntimeResponse<CapturePayload> = await browser.tabs.sendMessage(tab.id, {
    version: MESSAGE_PROTOCOL_VERSION,
    type: 'content/full',
  } satisfies RuntimeMessage);
  if (!response.ok || !response.data) return response;
  return storeCapture(tab.id, message.collectionId, response.data);
}

async function handleSelectionStart(
  message: Extract<RuntimeMessage, { type: 'capture/select' }>,
): Promise<RuntimeResponse> {
  const tab = await activeTab();
  await injectCaptureRuntime(tab.id);
  await browser.tabs.sendMessage(tab.id, {
    version: MESSAGE_PROTOCOL_VERSION,
    type: 'content/select',
    collectionId: message.collectionId,
    faithful: true,
  } satisfies RuntimeMessage);
  return { ok: true };
}

async function handleMessage(
  message: RuntimeMessage,
  sender: Browser.runtime.MessageSender,
): Promise<RuntimeResponse> {
  if (message.type === 'capture/full') return handleFullCapture(message);
  if (message.type === 'capture/select') return handleSelectionStart(message);
  if (message.type === 'capture/selection-ready') {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return { ok: false, error: 'Se perdió la pestaña capturada.' };
    return storeCapture(tabId, message.collectionId, message.payload);
  }
  return { ok: false, error: 'Mensaje no reconocido por el coordinador.' };
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void ensureDefaultCollection();
  });

  browser.runtime.onMessage.addListener((value: unknown, sender, sendResponse) => {
    if (!isRuntimeMessage(value)) return undefined;
    void handleMessage(value, sender)
      .catch((error: unknown): RuntimeResponse => ({
        ok: false,
        error: error instanceof Error ? error.message : 'Ocurrió un error inesperado.',
      }))
      .then(sendResponse);
    return true;
  });
});
