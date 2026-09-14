const PRINT_SURFACE_ID = '__collection_web_pdf_print_surface__';
const PRINT_STYLE_ID = '__collection_web_pdf_print_style__';

const STYLE_PROPERTIES = [
  'display',
  'box-sizing',
  'width',
  'max-width',
  'margin',
  'padding',
  'font',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'text-align',
  'white-space',
  'color',
  'background-color',
  'border',
  'border-collapse',
  'list-style',
  'grid-template-columns',
  'gap',
  'flex',
  'overflow-wrap',
  'object-fit',
] as const;

function containsExcluded(element: Element, excluded: ReadonlySet<Element>): boolean {
  if (excluded.size === 0) return false;
  for (const candidate of excluded) {
    if (candidate === element || candidate.contains(element)) return true;
  }
  return false;
}

function cloneNodeWithStyles(node: Node, excluded: ReadonlySet<Element>): Node | undefined {
  if (node.nodeType === Node.TEXT_NODE) return node.cloneNode();
  if (!(node instanceof Element) || containsExcluded(node, excluded)) return undefined;
  if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(node.tagName)) return undefined;

  if (node instanceof HTMLCanvasElement) {
    try {
      const image = document.createElement('img');
      image.src = node.toDataURL('image/png');
      image.alt = node.getAttribute('aria-label') || 'Contenido de canvas';
      return image;
    } catch {
      const placeholder = document.createElement('p');
      placeholder.textContent = '[Canvas no disponible]';
      return placeholder;
    }
  }

  if (node instanceof HTMLIFrameElement) {
    const placeholder = document.createElement('p');
    placeholder.textContent = `[Contenido incrustado no capturado: ${node.title || node.src || 'iframe'}]`;
    return placeholder;
  }

  const clone = node.cloneNode(false) as HTMLElement;
  clone.removeAttribute('id');
  for (const attribute of Array.from(clone.attributes)) {
    if (attribute.name.startsWith('on')) clone.removeAttribute(attribute.name);
  }

  const computed = getComputedStyle(node);
  // Poda subárboles ocultos: evita clonar y copiar estilos de ramas invisibles.
  if (computed.display === 'none' || computed.visibility === 'hidden') return undefined;
  for (const property of STYLE_PROPERTIES) {
    const value = computed.getPropertyValue(property);
    if (value) clone.style.setProperty(property, value, computed.getPropertyPriority(property));
  }
  clone.style.setProperty('animation', 'none', 'important');
  clone.style.setProperty('transition', 'none', 'important');

  if (node instanceof HTMLImageElement) {
    clone.setAttribute('src', node.currentSrc || node.src);
    clone.removeAttribute('srcset');
  }
  if (node instanceof HTMLInputElement) clone.setAttribute('value', node.type === 'password' ? '' : node.value);
  if (node instanceof HTMLTextAreaElement) clone.textContent = node.value;
  if (node instanceof HTMLSelectElement) {
    const selected = Array.from(node.selectedOptions).map((option) => option.text).join(', ');
    clone.textContent = selected;
  }

  for (const child of Array.from(node.childNodes)) {
    const childClone = cloneNodeWithStyles(child, excluded);
    if (childClone) clone.append(childClone);
  }
  if (node.shadowRoot) {
    for (const child of Array.from(node.shadowRoot.childNodes)) {
      const childClone = cloneNodeWithStyles(child, excluded);
      if (childClone) clone.append(childClone);
    }
  }
  return clone;
}

export function buildStyledSelectionHtml(included: Element[], excluded: Element[]): string {
  const wrapper = document.createElement('main');
  wrapper.style.cssText =
    'display:block;box-sizing:border-box;width:100%;max-width:100%;padding:24px;background:#fff;color:#111;';
  const excludedSet = new Set(excluded);
  for (const element of included) {
    const clone = cloneNodeWithStyles(element, excludedSet);
    if (clone) {
      const section = document.createElement('section');
      section.style.cssText = 'display:block;max-width:100%;break-after:auto;margin:0 0 24px;';
      section.append(clone);
      wrapper.append(section);
    }
  }
  return wrapper.outerHTML;
}

export function installPrintSurface(html: string): () => void {
  removePrintSurface();
  const surface = document.createElement('div');
  surface.id = PRINT_SURFACE_ID;
  surface.setAttribute('aria-label', 'Superficie temporal de impresión');
  surface.innerHTML = html;
  surface.style.cssText =
    'display:block!important;position:absolute!important;inset:0 auto auto 0!important;width:100%!important;min-height:100%!important;z-index:2147483646!important;background:white!important;overflow:visible!important;';

  const style = document.createElement('style');
  style.id = PRINT_STYLE_ID;
  style.textContent = `
    body > :not(#${PRINT_SURFACE_ID}) { display: none !important; }
    #${PRINT_SURFACE_ID} {
      display: block !important;
      position: static !important;
      width: auto !important;
      height: auto !important;
      overflow: visible !important;
      background: white !important;
    }
  `;
  document.documentElement.append(style);
  document.body.append(surface);
  return removePrintSurface;
}

export function removePrintSurface(): void {
  document.getElementById(PRINT_SURFACE_ID)?.remove();
  document.getElementById(PRINT_STYLE_ID)?.remove();
}
