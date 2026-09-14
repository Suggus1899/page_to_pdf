/// <reference lib="webworker" />

import { generateReadablePdf } from './readable';
import type { PdfWorkerRequest, PdfWorkerResponse } from './types';

const worker = self as unknown as DedicatedWorkerGlobalScope;

worker.addEventListener('message', (event: MessageEvent<PdfWorkerRequest>) => {
  const request = event.data;
  if (request.profile !== 'readable') return;
  const progress = (percent: number, label: string): void => {
    worker.postMessage({ id: request.id, type: 'progress', percent, label } satisfies PdfWorkerResponse);
  };

  void generateReadablePdf(request, progress)
    .then((pdf) => {
      worker.postMessage(
        { id: request.id, type: 'complete', pdf } satisfies PdfWorkerResponse,
        [pdf],
      );
    })
    .catch((error: unknown) => {
      worker.postMessage({
        id: request.id,
        type: 'error',
        error: error instanceof Error ? error.message : 'No se pudo generar el PDF.',
      } satisfies PdfWorkerResponse);
    });
});
