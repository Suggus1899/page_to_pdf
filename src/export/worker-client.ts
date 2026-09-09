import PdfWorker from './pdf.worker?worker';
import type { PdfWorkerRequest, PdfWorkerResponse } from './types';

export function createPdfInWorker(
  request: PdfWorkerRequest,
  onProgress: (percent: number, label: string) => void,
): Promise<ArrayBuffer> {
  const worker = new PdfWorker();
  return new Promise((resolve, reject) => {
    const finish = (): void => worker.terminate();
    worker.addEventListener('message', (event: MessageEvent<PdfWorkerResponse>) => {
      const response = event.data;
      if (response.id !== request.id) return;
      if (response.type === 'progress') {
        onProgress(response.percent, response.label);
      } else if (response.type === 'complete') {
        finish();
        resolve(response.pdf);
      } else {
        finish();
        reject(new Error(response.error));
      }
    });
    worker.addEventListener('error', (event) => {
      finish();
      reject(new Error(event.message || 'El proceso de exportación se detuvo.'));
    });

    const transferables =
      request.profile === 'faithful' ? request.items.map((entry) => entry.pdf) : [];
    worker.postMessage(request, transferables);
  });
}
