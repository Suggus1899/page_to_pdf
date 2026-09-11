import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PdfWorkerRequest } from '../src/export/types';
import type { CapturePayload } from '../src/domain/types';
import {
  addCapture,
  clearAllData,
  createCollection,
  listCaptureItems,
} from '../src/storage/database';

let finishPdf: ((value: ArrayBuffer) => void) | undefined;

vi.mock('../src/export/worker-client', () => ({
  createPdfInWorker: vi.fn(
    (_request: PdfWorkerRequest, onProgress: (percent: number, label: string) => void) => {
      onProgress(50, 'Generando PDF de prueba');
      return new Promise<ArrayBuffer>((resolve) => {
        finishPdf = resolve;
      });
    },
  ),
}));

import { ManagerApp } from '../entrypoints/manager/ManagerApp';
import { createPdfInWorker } from '../src/export/worker-client';

function payload(title: string): CapturePayload {
  const capturedAt = new Date().toISOString();
  return {
    title,
    url: 'https://example.test/app',
    capturedAt,
    viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
    scope: { kind: 'full-page' },
    warnings: [],
    document: {
      schemaVersion: 1,
      title,
      url: 'https://example.test/app',
      capturedAt,
      language: 'es',
      blocks: [{ type: 'paragraph', text: 'Contenido ' + title, links: [] }],
    },
  };
}

describe('administrador', () => {
  const download = vi.fn<(options: { filename: string }) => Promise<number>>();
  let collectionId = '';

  beforeEach(async () => {
    finishPdf = undefined;
    await clearAllData();
    const collection = await createCollection('Proyecto');
    collectionId = collection.id;
    await addCapture(collection.id, payload('Vista A'));
    await addCapture(collection.id, payload('Vista B'));
    download.mockReset();
    download.mockResolvedValue(1);
    vi.mocked(createPdfInWorker).mockClear();
    vi.stubGlobal('browser', {
      downloads: { download },
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({
          ok: true,
          data: {
            configured: true,
            signedIn: true,
            email: 'prueba@example.com',
            emailVerified: true,
            plan: 'free',
            freeBytesLimit: 150 * 1024 * 1024,
            freeBytesUsed: 0,
            subscriptionStatus: 'none',
            supportBenefitUsed: false,
          },
        }),
      },
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:pdf-de-prueba'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('muestra progreso, reordena, elimina y conserva el resultado', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ManagerApp />);

    const firstTitle = await screen.findByDisplayValue('Vista A');
    const firstRow = firstTitle.closest('article');
    if (!firstRow) throw new Error('No se encontró la fila inicial.');
    await user.click(within(firstRow).getByRole('button', { name: 'Bajar Vista A' }));
    await waitFor(async () => {
      expect((await listCaptureItems(collectionId)).map((item) => item.title)).toEqual([
        'Vista B',
        'Vista A',
      ]);
    });
    const collections = screen.getByRole('navigation', { name: 'Colecciones guardadas' });
    expect(collections).toHaveTextContent('2 vistas');
    expect(screen.getByRole('button', { name: 'Exportar PDF visual' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Exportar versión IA' })).toBeEnabled();
    expect(screen.getByText(/2 vistas fueron guardadas solo como texto/)).toBeVisible();
    expect(screen.getAllByText('Solo versión IA')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Exportar versión IA' }));
    expect(await screen.findByText('Generando PDF de prueba')).toBeVisible();
    act(() => finishPdf?.(new ArrayBuffer(8)));
    await waitFor(() => expect(download).toHaveBeenCalled());
    expect(download.mock.calls[0]?.[0].filename).toMatch(/^Proyecto_\d{4}-\d{2}-\d{2}\.pdf$/);

    const rowA = screen.getByDisplayValue('Vista A').closest('article');
    if (!rowA) throw new Error('No se encontró la vista a eliminar.');
    await user.click(within(rowA).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(screen.queryByDisplayValue('Vista A')).not.toBeInTheDocument());
    expect((await listCaptureItems(collectionId)).map((item) => item.title)).toEqual(['Vista B']);
    expect(screen.getByRole('navigation', { name: 'Colecciones guardadas' })).toHaveTextContent('1 vistas');
  });

  it('habilita la exportación visual cuando todas las vistas tienen PDF', async () => {
    await clearAllData();
    const collection = await createCollection('Visual');
    await addCapture(collection.id, payload('Vista visual'), new ArrayBuffer(8));
    const user = userEvent.setup();
    render(<ManagerApp />);

    const exportButton = await screen.findByRole('button', { name: 'Exportar PDF visual' });
    await waitFor(() => expect(exportButton).toBeEnabled());
    expect(screen.queryByText(/solo como texto/)).not.toBeInTheDocument();
    await user.click(exportButton);
    expect(await screen.findByText('Generando PDF de prueba')).toBeVisible();
    expect(createPdfInWorker).toHaveBeenCalledWith(
      expect.objectContaining({ profile: 'faithful' }),
      expect.any(Function),
    );
    act(() => finishPdf?.(new ArrayBuffer(8)));
    await waitFor(() => expect(download).toHaveBeenCalled());
  });

  it('abre la vista previa en un diálogo y devuelve el foco al cerrarla', async () => {
    await clearAllData();
    const collection = await createCollection('Visual');
    await addCapture(collection.id, payload('Vista visual'), new ArrayBuffer(8));
    const user = userEvent.setup();
    render(<ManagerApp />);

    const previewButton = await screen.findByRole('button', { name: 'Ver PDF visual' });
    await user.click(previewButton);
    const dialog = await screen.findByRole('dialog', { name: 'Vista visual' });
    expect(dialog).toBeVisible();

    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(previewButton).toHaveFocus();
  });

  it('bloquea las exportaciones mientras una captura está pendiente', async () => {
    await clearAllData();
    const collection = await createCollection('Pendiente');
    await addCapture(
      collection.id,
      payload('Vista pendiente'),
      new ArrayBuffer(8),
      { reservationId: 'reservation-1' },
    );
    render(<ManagerApp />);

    expect(await screen.findByText('Validación pendiente')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Exportar PDF visual' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Exportar versión IA' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Recuperar ahora' })).toBeEnabled();
  });
});
