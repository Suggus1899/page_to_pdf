import FaithfulWorker from './faithful.worker?worker';
import ReadableWorker from './readable.worker?worker';
import type { PdfWorkerRequest, PdfWorkerResponse } from './types';

export function createPdfInWorker(
  request: PdfWorkerRequest,
  onProgress: (percent: number, label: string) => void,
): Promise<ArrayBuffer> {
  // Workers separados por perfil: la ruta fiel no descarga pdfmake+vfs
  // (~1MB+) y la legible no descarga pdf-lib. Ahorro directo en .output.
  const worker = request.profile === 'faithful' ? new FaithfulWorker() : new ReadableWorker();
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
