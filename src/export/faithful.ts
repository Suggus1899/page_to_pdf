import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { PrintSettings } from '../domain/types';
import type { PdfWorkerRequest } from './types';

function pageSize(settings: PrintSettings): [number, number] {
  const base: [number, number] = settings.paper === 'a4' ? [595.28, 841.89] : [612, 792];
  return settings.orientation === 'landscape' ? [base[1], base[0]] : base;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawLines(
  page: PDFPage,
  lines: string[],
  options: { x: number; y: number; size: number; font: PDFFont; color?: ReturnType<typeof rgb>; lineHeight?: number },
): number {
  const lineHeight = options.lineHeight ?? options.size * 1.35;
  let y = options.y;
  for (const line of lines) {
    page.drawText(line, {
      x: options.x,
      y,
      size: options.size,
      font: options.font,
      color: options.color ?? rgb(0.09, 0.13, 0.2),
    });
    y -= lineHeight;
  }
  return y;
}

export async function generateFaithfulPdf(
  request: Extract<PdfWorkerRequest, { profile: 'faithful' }>,
  onProgress: (percent: number, label: string) => void,
): Promise<ArrayBuffer> {
  onProgress(5, 'Leyendo fragmentos fieles');
  const sourceDocuments = [];
  for (let index = 0; index < request.items.length; index += 1) {
    const source = await PDFDocument.load(request.items[index]!.pdf);
    sourceDocuments.push(source);
    onProgress(5 + Math.round(((index + 1) / request.items.length) * 15), `Leyendo vista ${index + 1}`);
  }

  const output = await PDFDocument.create();
  const font = await output.embedFont(StandardFonts.Helvetica);
  const bold = await output.embedFont(StandardFonts.HelveticaBold);
  const size = pageSize(request.collection.printSettings);
  const margin = request.collection.printSettings.marginInches * 72;

  const cover = output.addPage(size);
  const coverTitle = wrapText(request.collection.name, bold, 28, size[0] - margin * 2);
  drawLines(cover, coverTitle, {
    x: margin,
    y: size[1] * 0.64,
    size: 28,
    font: bold,
    color: rgb(0.07, 0.14, 0.25),
    lineHeight: 34,
  });
  cover.drawText(`${request.items.length} vistas web`, {
    x: margin,
    y: size[1] * 0.5,
    size: 13,
    font,
    color: rgb(0.32, 0.38, 0.47),
  });

  const rowsPerTocPage = 26;
  const tocPageCount = Math.max(1, Math.ceil(request.items.length / rowsPerTocPage));
  const starts: number[] = [];
  let nextStart = 2 + tocPageCount;
  sourceDocuments.forEach((source) => {
    starts.push(nextStart);
    nextStart += 1 + source.getPageCount();
  });

  for (let pageIndex = 0; pageIndex < tocPageCount; pageIndex += 1) {
    const page = output.addPage(size);
    page.drawText('Índice', { x: margin, y: size[1] - margin - 8, size: 24, font: bold });
    let y = size[1] - margin - 44;
    const slice = request.items.slice(pageIndex * rowsPerTocPage, (pageIndex + 1) * rowsPerTocPage);
    slice.forEach(({ item }, rowIndex) => {
      const absoluteIndex = pageIndex * rowsPerTocPage + rowIndex;
      const title = wrapText(item.title, font, 10, size[0] - margin * 2 - 48)[0] || 'Vista';
      page.drawText(title.slice(0, 100), { x: margin, y, size: 10, font });
      page.drawText(String(starts[absoluteIndex]), {
        x: size[0] - margin - 24,
        y,
        size: 10,
        font: bold,
      });
      y -= 24;
    });
  }

  for (let index = 0; index < request.items.length; index += 1) {
    const { item } = request.items[index]!;
    const separator = output.addPage(size);
    const titleLines = wrapText(item.title, bold, 22, size[0] - margin * 2);
    let y = drawLines(separator, titleLines, {
      x: margin,
      y: size[1] - margin - 24,
      size: 22,
      font: bold,
      lineHeight: 28,
    });
    y -= 22;
    y = drawLines(separator, wrapText(item.url, font, 9, size[0] - margin * 2), {
      x: margin,
      y,
      size: 9,
      font,
      color: rgb(0.15, 0.39, 0.72),
      lineHeight: 13,
    });
    separator.drawText(`Capturado: ${new Date(item.capturedAt).toLocaleString('es-VE')}`, {
      x: margin,
      y: y - 16,
      size: 9,
      font,
      color: rgb(0.32, 0.38, 0.47),
    });

    const source = sourceDocuments[index]!;
    const copied = await output.copyPages(source, source.getPageIndices());
    copied.forEach((page) => output.addPage(page));
    onProgress(25 + Math.round(((index + 1) / request.items.length) * 65), `Combinando vista ${index + 1}`);
  }

  output.setTitle(request.collection.name);
  output.setSubject('Colección de capturas fieles de vistas web');
  output.setCreator('Colección Web PDF');
  output.setProducer('pdf-lib');
  output.setCreationDate(new Date());
  const bytes = await output.save({ useObjectStreams: true, objectsPerTick: 50 });
  onProgress(100, 'PDF fiel listo');
  return new Uint8Array(bytes).slice().buffer;
}
