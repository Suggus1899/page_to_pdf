import type {
  CapturePayload,
  CaptureScope,
  SemanticBlock,
  SemanticDocument,
  SemanticLink,
} from '../domain/types';

const IGNORED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'NAV',
  'ASIDE',
]);
const BLOCK_TAGS = new Set([
  'P',
  'UL',
  'OL',
  'TABLE',
  'PRE',
  'BLOCKQUOTE',
  'FIGURE',
  'IMG',
  'IFRAME',
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
]);

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function isExcluded(element: Element, excluded: ReadonlySet<Element>): boolean {
  if (excluded.size === 0) return false;
  // O(profundidad) con Set.has en vez de O(excluidos) con .contains() por nodo.
  let current: Element | null = element;
  while (current) {
    if (excluded.has(current)) return true;
    if (current.parentElement) {
      current = current.parentElement;
      continue;
    }
    const root = current.getRootNode();
    current = root instanceof ShadowRoot ? root.host : null;
  }
  return false;
}

function isVisible(element: Element): boolean {
  if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') {
    return false;
  }
  // checkVisibility evita el reflow de getComputedStyle en el recorrido caliente.
  const checkable = element as HTMLElement & {
    checkVisibility?: (options?: { checkOpacity?: boolean; checkVisibilityCSS?: boolean }) => boolean;
  };
  if (typeof checkable.checkVisibility === 'function') {
    try {
      if (!checkable.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      return true;
    } catch {
      // Cae al camino clásico si el navegador no soporta las opciones.
    }
  }
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function linksFrom(element: Element): SemanticLink[] {
  const links: SemanticLink[] = [];
  for (const anchor of element.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    // textContent primero: evita el layout forzado de innerText en el camino caliente.
    const label = normalizeText(anchor.textContent || anchor.innerText);
    if (!label) continue;
    try {
      links.push({ label, url: new URL(anchor.href, location.href).href });
    } catch {
      // Ignore malformed links rather than dropping the surrounding text.
    }
  }
  return links;
}

function fieldText(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  if (element instanceof HTMLInputElement && element.type === 'password') return '';
  const label =
    element.labels?.[0]?.textContent ||
    element.getAttribute('aria-label') ||
    element.getAttribute('placeholder') ||
    element.name;
  const value =
    element instanceof HTMLSelectElement
      ? Array.from(element.selectedOptions)
          .map((option) => option.text)
          .join(', ')
      : element.value;
  return [normalizeText(label), normalizeText(value)].filter(Boolean).join(': ');
}

function directText(element: Element): string {
  return normalizeText(
    Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join(' '),
  );
}

function elementChildren(element: Element): Element[] {
  const children = Array.from(element.children);
  if (element.shadowRoot) children.push(...Array.from(element.shadowRoot.children));
  return children;
}

function tableBlock(table: HTMLTableElement): SemanticBlock | undefined {
  const rows = Array.from(table.rows)
    .map((row) => Array.from(row.cells).map((cell) => normalizeText(cell.textContent)))
    .filter((row) => row.some(Boolean));
  if (rows.length === 0) return undefined;
  const firstRow = table.rows[0];
  const headerRows = firstRow && Array.from(firstRow.cells).every((cell) => cell.tagName === 'TH') ? 1 : 0;
  return { type: 'table', rows, headerRows };
}

function blockForElement(element: Element): SemanticBlock | undefined {
  const tag = element.tagName;
  // textContent primero: el filtro isVisible ya garantizó visibilidad, sin forzar layout.
  const text = normalizeText(element.textContent || (element as HTMLElement).innerText);

  if (/^H[1-6]$/.test(tag) && text) {
    return {
      type: 'heading',
      level: Number(tag.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6,
      text,
      links: linksFrom(element),
    };
  }
  if (tag === 'P' && text) return { type: 'paragraph', text, links: linksFrom(element) };
  if ((tag === 'UL' || tag === 'OL') && text) {
    const items = Array.from(element.children)
      .filter((child) => child.tagName === 'LI')
      .map((item) => normalizeText(item.textContent))
      .filter(Boolean);
    return items.length > 0 ? { type: 'list', ordered: tag === 'OL', items } : undefined;
  }
  if (tag === 'TABLE') return tableBlock(element as HTMLTableElement);
  if (tag === 'PRE' && text) return { type: 'code', text };
  if (tag === 'BLOCKQUOTE' && text) return { type: 'quote', text };
  if (tag === 'IMG') {
    const image = element as HTMLImageElement;
    const sourceUrl = image.currentSrc || image.src;
    return {
      type: 'figure',
      alt: normalizeText(image.alt) || 'Imagen sin texto alternativo',
      ...(sourceUrl ? { sourceUrl } : {}),
    };
  }
  if (tag === 'FIGURE') {
    const image = element.querySelector<HTMLImageElement>('img');
    const caption = normalizeText(element.querySelector('figcaption')?.textContent);
    const sourceUrl = image?.currentSrc || image?.src;
    return {
      type: 'figure',
      alt: normalizeText(image?.alt) || caption || 'Figura',
      ...(caption ? { caption } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
    };
  }
  if (tag === 'IFRAME') {
    const iframe = element as HTMLIFrameElement;
    return {
      type: 'paragraph',
      text: `[Contenido incrustado no capturado: ${iframe.title || iframe.src || 'iframe'}]`,
      links: iframe.src ? [{ label: iframe.title || 'Contenido incrustado', url: iframe.src }] : [],
    };
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    const value = fieldText(element);
    return value ? { type: 'paragraph', text: value, links: [] } : undefined;
  }
  if (tag === 'A' && text) {
    const anchor = element as HTMLAnchorElement;
    return { type: 'link', label: text, url: anchor.href };
  }
  return undefined;
}

async function imageToDataUrl(sourceUrl: string): Promise<string | undefined> {
  if (sourceUrl.startsWith('data:image/')) return sourceUrl;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const url = new URL(sourceUrl, location.href);
    if (url.origin !== location.origin) return undefined;
    // Sin compresión por decisión de producto: solo concurrencia + timeout.
    const response = await fetch(url.href, { credentials: 'include', signal: controller.signal });
    if (!response.ok) return undefined;
    const blob = await response.blob();
    if (!blob.type.startsWith('image/') || blob.size > 2 * 1024 * 1024) return undefined;
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        if (typeof reader.result === 'string') resolve(reader.result);
        else reject(new Error('La imagen no produjo un resultado legible.'));
      }, { once: true });
      reader.addEventListener('error', () => reject(reader.error ?? new Error('No se pudo leer la imagen.')), { once: true });
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function hydrateFigures(blocks: SemanticBlock[]): Promise<void> {
  // devwf: techo conocido — máx 10 figuras hidratadas; concurrencia 3 con timeout
  // por imagen en vez de serie para no bloquear la captura en webs con medios.
  const figures = blocks.filter(
    (block): block is Extract<SemanticBlock, { type: 'figure' }> =>
      block.type === 'figure' && Boolean(block.sourceUrl),
  );
  let hydrated = 0;
  for (let index = 0; index < figures.length && hydrated < 10; index += 3) {
    const batch = figures.slice(index, index + 3);
    const results = await Promise.all(
      batch.map((block) => imageToDataUrl(block.sourceUrl as string)),
    );
    for (let offset = 0; offset < batch.length && hydrated < 10; offset += 1) {
      const block = batch[offset]!;
      const dataUrl = results[offset];
      if (dataUrl) {
        block.dataUrl = dataUrl;
        hydrated += 1;
      }
    }
  }
}

export async function extractSemanticDocument(
  roots: Element[],
  excludedElements: Element[],
  scope: CaptureScope,
): Promise<CapturePayload> {
  const excluded = new Set(excludedElements);
  const blocks: SemanticBlock[] = [];
  const seen = new Set<Element>();

  const visit = (element: Element): void => {
    if (seen.has(element) || isExcluded(element, excluded) || IGNORED_TAGS.has(element.tagName)) return;
    seen.add(element);
    if (!isVisible(element)) return;

    const block = blockForElement(element);
    if (block) {
      blocks.push(block);
      return;
    }

    const ownText = element.tagName === 'LABEL' ? '' : directText(element);
    if (ownText) blocks.push({ type: 'paragraph', text: ownText, links: [] });
    for (const child of elementChildren(element)) visit(child);

    if (!ownText && elementChildren(element).length === 0 && !BLOCK_TAGS.has(element.tagName)) {
      const text = normalizeText(element.textContent);
      if (text) blocks.push({ type: 'paragraph', text, links: linksFrom(element) });
    }
  };

  roots.forEach(visit);
  await hydrateFigures(blocks);

  const capturedAt = new Date().toISOString();
  const semanticDocument: SemanticDocument = {
    schemaVersion: 1,
    title: document.title || location.hostname,
    url: location.href,
    capturedAt,
    language: document.documentElement.lang || navigator.language || 'es',
    blocks,
  };

  return {
    title: semanticDocument.title,
    url: semanticDocument.url,
    capturedAt,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    scope,
    document: semanticDocument,
    warnings: blocks.length === 0 ? ['No se encontró contenido legible en la selección.'] : [],
  };
}
