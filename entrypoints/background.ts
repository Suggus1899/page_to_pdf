import type { CaptureItem, CapturePayload, CollectionDraft } from '../src/domain/types';
import { protectAccountStorage } from '../src/account/storage-protection';
import { assertCollectionCapacity } from '../src/domain/limits';
import { captureTabAsPdf, hasDebuggerPermission } from '../src/pdf/chromium';
import {
  isRuntimeMessage,
  MESSAGE_PROTOCOL_VERSION,
  type RuntimeMessage,
  type RuntimeResponse,
} from '../src/runtime/messages';
import {
  addCapture,
  captureBytes,
  ensureDefaultCollection,
  getCollection,
  listPendingCaptureItems,
  markCaptureReady,
} from '../src/storage/database';

function assertInjectable(tab: Browser.tabs.Tab): asserts tab is Browser.tabs.Tab & { id: number; url: string } {
  if (tab.id === undefined || !tab.url || !/^(https?|file):/i.test(tab.url)) {
    throw new Error('Esta página está protegida por el navegador y no puede capturarse.');
  }
}

// Import dinámico: supabase-js (~100KB+) solo se descarga cuando una acción de
// cuenta/cuota lo necesita, no en cada arranque del service worker.
function gateway() {
  return import('../src/account/gateway');
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
  const bytes = captureBytes(payload, faithfulPdf);
  assertCollectionCapacity(collection, bytes);
  const operationId = crypto.randomUUID();
  const { reserveCapture, cancelCaptureReservation, commitCapture } = await gateway();
  const reservation = await reserveCapture(operationId, bytes);
  let item: CaptureItem;
  try {
    item = await addCapture(collectionId, payload, faithfulPdf, {
      reservationId: reservation.id,
      bytes,
    });
  } catch (error) {
    await cancelCaptureReservation(reservation.id).catch(() => undefined);
    throw error;
  }

  try {
    await commitCapture(reservation.id);
    item = await markCaptureReady(item.id);
  } catch {
    return {
      ok: false,
      error: 'La captura quedó guardada y pendiente de validar. Abre el administrador con conexión para recuperarla.',
    };
  }
  await browser.action.setBadgeBackgroundColor({ color: '#16a34a', tabId });
  await browser.action.setBadgeText({ text: '✓', tabId });
  setTimeout(() => void browser.action.setBadgeText({ text: '', tabId }), 2500);
  return { ok: true, data: item };
}

async function handleFullCapture(
  message: Extract<RuntimeMessage, { type: 'capture/full' }>,
): Promise<RuntimeResponse> {
  const { requireCaptureAccess } = await gateway();
  await requireCaptureAccess();
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
  const { requireCaptureAccess } = await gateway();
  await requireCaptureAccess();
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

async function reconcilePendingCaptures(): Promise<number> {
  const { requireCaptureAccess, reconcileCaptureReservation } = await gateway();
  await requireCaptureAccess();
  const pending = await listPendingCaptureItems();
  let recovered = 0;
  for (const item of pending) {
    if (!item.quotaReservationId) continue;
    await reconcileCaptureReservation(item.quotaReservationId);
    await markCaptureReady(item.id);
    recovered += 1;
  }
  return recovered;
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
  if (message.type === 'account/snapshot') {
    const { getAccountSnapshot } = await gateway();
    return { ok: true, data: await getAccountSnapshot() };
  }
  if (message.type === 'account/sign-in') {
    const { signIn } = await gateway();
    return { ok: true, data: await signIn(message.email, message.password) };
  }
  if (message.type === 'account/sign-up') {
    const { signUp } = await gateway();
    return { ok: true, data: await signUp(message.email, message.password) };
  }
  if (message.type === 'account/sign-out') {
    const { signOut } = await gateway();
    return { ok: true, data: await signOut() };
  }
  if (message.type === 'billing/checkout') {
    const { createCheckout } = await gateway();
    const checkout = await createCheckout(message.kind, message.amountCents);
    await browser.tabs.create({ url: checkout.checkoutUrl });
    return { ok: true, data: { opened: true } };
  }
  if (message.type === 'billing/cancel-subscription') {
    const { cancelSubscription } = await gateway();
    return { ok: true, data: await cancelSubscription() };
  }
  if (message.type === 'quota/reconcile') {
    return { ok: true, data: { recovered: await reconcilePendingCaptures() } };
  }
  return { ok: false, error: 'Mensaje no reconocido por el coordinador.' };
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void ensureDefaultCollection();
    void protectAccountStorage();
  });

  browser.runtime.onStartup.addListener(() => {
    void protectAccountStorage();
    void reconcilePendingCaptures().catch(() => undefined);
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
