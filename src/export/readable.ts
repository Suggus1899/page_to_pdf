import pdfMake from 'pdfmake/build/pdfmake';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { SemanticBlock, SemanticLink } from '../domain/types';
import type { PdfWorkerRequest } from './types';
import { installSubsetFonts } from './fonts';

installSubsetFonts();

function linkNotes(links: SemanticLink[]): Content[] {
  if (links.length === 0) return [];
  return links.map((link) => ({
    text: `${link.label}: ${link.url}`,
    link: link.url,
    color: '#2563eb',
    fontSize: 8,
    margin: [0, 2, 0, 0],
  }));
}

function blockToContent(block: SemanticBlock): Content[] {
  switch (block.type) {
    case 'heading':
      return [
        {
          text: block.text,
          style: `h${block.level}`,
          margin: [0, block.level <= 2 ? 14 : 10, 0, 5],
        },
        ...linkNotes(block.links),
      ];
    case 'paragraph':
      return [
        { text: block.text, style: 'paragraph' },
        ...linkNotes(block.links),
      ];
    case 'list':
      return [
        block.ordered
          ? { ol: block.items.map((text) => ({ text })), style: 'paragraph' }
          : { ul: block.items.map((text) => ({ text })), style: 'paragraph' },
      ];
    case 'table': {
      const columnCount = Math.max(...block.rows.map((row) => row.length), 1);
      const body = block.rows.map((row) => [
        ...row,
        ...Array.from({ length: columnCount - row.length }, () => ''),
      ]);
      return [
        {
          table: {
            headerRows: block.headerRows,
            widths: Array.from({ length: columnCount }, () => '*'),
            body,
          },
          layout: 'lightHorizontalLines',
          fontSize: 8,
          margin: [0, 6, 0, 10],
        },
      ];
    }
    case 'code':
      return [
        {
          text: block.text,
          style: 'code',
          preserveLeadingSpaces: true,
        },
      ];
    case 'quote':
      return [{ text: block.text, style: 'quote' }];
    case 'figure':
      if (block.dataUrl) {
        return [
          { image: block.dataUrl, fit: [480, 360], margin: [0, 8, 0, 4] },
          { text: block.caption || block.alt, style: 'caption' },
        ];
      }
      return [
        {
          text: `[Imagen: ${block.caption || block.alt}]${block.sourceUrl ? `\n${block.sourceUrl}` : ''}`,
          style: 'caption',
          ...(block.sourceUrl ? { link: block.sourceUrl } : {}),
        },
      ];
    case 'link':
      return [{ text: `${block.label}: ${block.url}`, link: block.url, color: '#2563eb' }];
    case 'section-break':
      return [{ text: '', pageBreak: 'after' }];
  }
}

function getBuffer(documentDefinition: TDocumentDefinitions): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(documentDefinition).getBuffer((buffer: Uint8Array) => {
        resolve(new Uint8Array(buffer).slice().buffer);
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export async function generateReadablePdf(
  request: Extract<PdfWorkerRequest, { profile: 'readable' }>,
  onProgress: (percent: number, label: string) => void,
): Promise<ArrayBuffer> {
  onProgress(10, 'Construyendo el documento legible');
  const margin = request.collection.printSettings.marginInches * 72;
  const content: Content[] = [
    {
      text: request.collection.name,
      style: 'coverTitle',
      margin: [0, 150, 0, 18],
    },
    {
      text: `${request.items.length} vistas · Exportado ${new Date().toLocaleString('es-VE')}`,
      style: 'coverMeta',
      pageBreak: 'after',
    },
    {
      toc: {
        title: { text: 'Índice', style: 'tocTitle' },
      },
      pageBreak: 'after',
    },
  ];

  request.items.forEach(({ item, document }, index) => {
    content.push(
      {
        text: item.title,
        style: 'viewTitle',
        tocItem: true,
        ...(index === 0 ? {} : { pageBreak: 'before' as const }),
      },
      {
        text: [
          { text: 'Fuente: ', bold: true },
          { text: item.url, link: item.url, color: '#2563eb' },
          { text: `\nCapturado: ${new Date(item.capturedAt).toLocaleString('es-VE')}` },
        ],
        style: 'source',
        margin: [0, 4, 0, 14],
      },
    );
    for (const block of document.blocks) content.push(...blockToContent(block));
    onProgress(15 + Math.round(((index + 1) / request.items.length) * 35), `Maquetando vista ${index + 1}`);
  });

  const definition: TDocumentDefinitions = {
    pageSize: request.collection.printSettings.paper === 'letter' ? 'LETTER' : 'A4',
    pageOrientation: request.collection.printSettings.orientation,
    pageMargins: [margin, margin, margin, margin],
    info: {
      title: request.collection.name,
      subject: 'Colección de vistas web para lectura y análisis',
      creator: 'Colección Web PDF',
      producer: 'pdfmake',
      creationDate: new Date(),
    },
    content,
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.3, color: '#172033' },
    styles: {
      coverTitle: { fontSize: 30, bold: true, alignment: 'center', color: '#13243f' },
      coverMeta: { fontSize: 12, alignment: 'center', color: '#526178' },
      tocTitle: { fontSize: 24, bold: true, margin: [0, 0, 0, 18] },
      viewTitle: { fontSize: 22, bold: true, color: '#13243f' },
      source: { fontSize: 8, color: '#526178' },
      paragraph: { margin: [0, 0, 0, 7] },
      h1: { fontSize: 20, bold: true },
      h2: { fontSize: 17, bold: true },
      h3: { fontSize: 14, bold: true },
      h4: { fontSize: 12, bold: true },
      h5: { fontSize: 11, bold: true },
      h6: { fontSize: 10, bold: true, italics: true },
      code: {
        fontSize: 8,
        background: '#eef2f7',
        margin: [8, 7, 8, 10],
        color: '#0f172a',
      },
      quote: { italics: true, color: '#475569', margin: [14, 6, 0, 10] },
      caption: { fontSize: 8, color: '#64748b', margin: [0, 0, 0, 9] },
    },
    footer: (currentPage: number, pageCount: number) => ({
      text: `${currentPage} / ${pageCount}`,
      alignment: 'center',
      fontSize: 8,
      color: '#64748b',
      margin: [0, 12, 0, 0],
    }),
  };

  onProgress(55, 'Generando páginas PDF');
  const result = await getBuffer(definition);
  onProgress(100, 'PDF legible listo');
  return result;
}
