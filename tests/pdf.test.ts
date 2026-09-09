import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PRINT_SETTINGS, type CaptureItem, type CollectionDraft } from '../src/domain/types';
import { generateFaithfulPdf } from '../src/export/faithful';
import { generateReadablePdf } from '../src/export/readable';

function collection(): CollectionDraft {
  return {
    id: 'collection-1',
    name: 'Investigación multivista',
    createdAt: '2026-09-09T12:00:00.000Z',
    updatedAt: '2026-09-09T12:00:00.000Z',
    itemCount: 2,
    bytesUsed: 0,
    status: 'ready',
    captureFaithful: true,
    printSettings: { ...DEFAULT_PRINT_SETTINGS },
  };
}

function item(id: string, title: string, position: number): CaptureItem {
  return {
    id,
    collectionId: 'collection-1',
    position,
    title,
    url: 'https://example.test/app',
    capturedAt: '2026-09-09T12:00:00.000Z',
    viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
    scope: { kind: 'full-page' },
    status: 'ready',
    readableAvailable: true,
    faithfulAvailable: true,
    bytesUsed: 0,
    warnings: [],
  };
}

async function onePagePdf(label: string): Promise<ArrayBuffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  page.drawText(label);
  return new Uint8Array(await pdf.save()).slice().buffer;
}

describe('generadores PDF', () => {
  it('crea portada, índice y vistas legibles en el orden recibido', async () => {
    const progress = vi.fn();
    const bytes = await generateReadablePdf(
      {
        id: 'readable-1',
        profile: 'readable',
        collection: collection(),
        items: [
          {
            item: item('a', 'Estado A', 0),
            document: {
              schemaVersion: 1,
              title: 'Estado A',
              url: 'https://example.test/app',
              capturedAt: '2026-09-09T12:00:00.000Z',
              language: 'es',
              blocks: [{ type: 'paragraph', text: 'Texto seleccionable A', links: [] }],
            },
          },
          {
            item: item('b', 'Estado B', 1),
            document: {
              schemaVersion: 1,
              title: 'Estado B',
              url: 'https://example.test/app',
              capturedAt: '2026-09-09T12:00:00.000Z',
              language: 'es',
              blocks: [{ type: 'table', rows: [['Clave', 'Valor'], ['B', '2']], headerRows: 1 }],
            },
          },
        ],
      },
      progress,
    );

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(4);
    expect(pdf.getTitle()).toBe('Investigación multivista');
    expect(progress).toHaveBeenLastCalledWith(100, 'PDF legible listo');
  }, 20_000);

  it('combina fragmentos fieles con portada, índice y separador por vista', async () => {
    const progress = vi.fn();
    const bytes = await generateFaithfulPdf(
      {
        id: 'faithful-1',
        profile: 'faithful',
        collection: collection(),
        items: [
          { item: item('a', 'Estado A', 0), pdf: await onePagePdf('A') },
          { item: item('b', 'Estado B', 1), pdf: await onePagePdf('B') },
        ],
      },
      progress,
    );

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(6);
    expect(pdf.getTitle()).toBe('Investigación multivista');
    expect(progress).toHaveBeenLastCalledWith(100, 'PDF fiel listo');
  });

  it('exporta 50 vistas sin bloquear el generador ni perder separadores', async () => {
    const largeCollection = collection();
    largeCollection.itemCount = 50;
    const items = Array.from({ length: 50 }, (_, index) => {
      const title = 'Vista ' + (index + 1);
      return {
        item: item(String(index), title, index),
        document: {
          schemaVersion: 1 as const,
          title,
          url: 'https://example.test/app',
          capturedAt: '2026-09-09T12:00:00.000Z',
          language: 'es',
          blocks: [{ type: 'paragraph' as const, text: 'Contenido ' + title, links: [] }],
        },
      };
    });

    const bytes = await generateReadablePdf(
      { id: 'readable-50', profile: 'readable', collection: largeCollection, items },
      vi.fn(),
    );
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(52);
  }, 30_000);
});
