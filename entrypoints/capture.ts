import { prepareDynamicContent } from '../src/capture/auto-scroll';
import { extractSemanticDocument } from '../src/capture/extract';
import {
  confirmPreparedCapture,
  describeSelectedElement,
  runSectionSelector,
  showPageToast,
} from '../src/capture/overlay';
import { installPrintSurface, removePrintSurface } from '../src/capture/print-surface';
import {
  isRuntimeMessage,
  MESSAGE_PROTOCOL_VERSION,
  type RuntimeMessage,
  type RuntimeResponse,
} from '../src/runtime/messages';

declare global {
  interface Window {
    __collectionWebPdfCaptureInstalled?: boolean;
  }
}

export default defineUnlistedScript(() => {
  if (window.__collectionWebPdfCaptureInstalled) return;
  window.__collectionWebPdfCaptureInstalled = true;

  const runFullCapture = async (): Promise<RuntimeResponse> => {
    const summary = await prepareDynamicContent();
    const confirmed = await confirmPreparedCapture(summary);
    if (!confirmed) return { ok: false, error: 'Captura cancelada.' };
    const payload = await extractSemanticDocument(
      [document.body],
      [],
      { kind: 'full-page' },
    );
    if (summary.reachedLimit) {
      payload.warnings.push('La preparación alcanzó el límite de desplazamiento o tiempo.');
    }
    return { ok: true, data: payload };
  };

  const runSelectionCapture = async (
    message: Extract<RuntimeMessage, { type: 'content/select' }>,
  ): Promise<void> => {
    try {
      const summary = await prepareDynamicContent();
      const selection = await runSectionSelector();
      if (!selection) return;

      const payload = await extractSemanticDocument(
        selection.included,
        selection.excluded,
        {
          kind: 'selection',
          included: selection.included.map(describeSelectedElement),
          excluded: selection.excluded.map(describeSelectedElement),
        },
      );
      if (summary.reachedLimit) {
        payload.warnings.push('La preparación alcanzó el límite de desplazamiento o tiempo.');
      }

      const cleanup = message.faithful
        ? installPrintSurface(selection.previewHtml)
        : () => undefined;
      try {
        const response: RuntimeResponse = await browser.runtime.sendMessage({
          version: MESSAGE_PROTOCOL_VERSION,
          type: 'capture/selection-ready',
          collectionId: message.collectionId,
          faithful: message.faithful,
          payload,
        } satisfies RuntimeMessage);
        showPageToast(response.ok ? 'Vista guardada en la colección.' : response.error || 'No se pudo guardar.', !response.ok);
      } finally {
        cleanup();
      }
    } catch (error) {
      showPageToast(error instanceof Error ? error.message : 'No se pudo capturar la selección.', true);
      removePrintSurface();
    }
  };

  browser.runtime.onMessage.addListener((value: unknown, _sender, sendResponse) => {
    if (!isRuntimeMessage(value)) return undefined;
    if (value.type === 'content/full') {
      void runFullCapture().then(sendResponse);
      return true;
    }
    if (value.type === 'content/select') {
      void runSelectionCapture(value);
      sendResponse({ ok: true } satisfies RuntimeResponse);
      return undefined;
    }
    if (value.type === 'content/cleanup-print') {
      removePrintSurface();
      sendResponse({ ok: true } satisfies RuntimeResponse);
      return undefined;
    }
    return undefined;
  });
});
