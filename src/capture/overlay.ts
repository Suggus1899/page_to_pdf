import type { PreparationSummary } from './auto-scroll';
import { buildStyledSelectionHtml } from './print-surface';

export interface SelectionResult {
  included: Element[];
  excluded: Element[];
  previewHtml: string;
}

const HOST_ID = '__collection_web_pdf_overlay__';

function createHost(): { host: HTMLDivElement; root: ShadowRoot } {
  document.getElementById(HOST_ID)?.remove();
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText =
    'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block;';
  const root = host.attachShadow({ mode: 'open' });
  document.documentElement.append(host);
  return { host, root };
}

function baseStyles(): string {
  return `
    :host { color-scheme: light; }
    * { box-sizing: border-box; }
    button { border:0; border-radius:9px; padding:9px 12px; font:600 13px/1 system-ui,sans-serif; cursor:pointer; }
    button:focus-visible { outline:3px solid #93c5fd; outline-offset:2px; }
    .primary { background:#2563eb; color:#fff; }
    .secondary { background:#e2e8f0; color:#0f172a; }
    .danger { background:#fee2e2; color:#991b1b; }
    .panel { pointer-events:auto; position:fixed; left:50%; bottom:22px; transform:translateX(-50%); width:min(720px,calc(100vw - 24px)); background:#fff; color:#0f172a; border:1px solid #cbd5e1; border-radius:14px; box-shadow:0 18px 60px rgba(15,23,42,.28); padding:14px; font:14px/1.4 system-ui,sans-serif; }
    .row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .status { margin-right:auto; min-width:220px; }
    .hint { color:#475569; font-size:12px; margin-top:7px; }
    .marker { position:fixed; pointer-events:none; border:3px solid #2563eb; background:rgba(37,99,235,.08); border-radius:4px; }
    .marker.exclude { border-color:#dc2626; background:rgba(220,38,38,.08); }
    .hover { border-style:dashed; border-color:#0ea5e9; background:rgba(14,165,233,.06); }
    .preview { pointer-events:auto; position:fixed; inset:16px; background:#e2e8f0; border-radius:16px; box-shadow:0 20px 80px rgba(15,23,42,.4); display:grid; grid-template-rows:auto 1fr; overflow:hidden; font:14px/1.4 system-ui,sans-serif; }
    .preview header { background:#fff; padding:12px; display:flex; align-items:center; gap:10px; border-bottom:1px solid #cbd5e1; }
    .preview header strong { margin-right:auto; }
    iframe { width:100%; height:100%; border:0; background:#fff; }
  `;
}

export function describeSelectedElement(element: Element): string {
  const id = element.id ? `#${element.id}` : '';
  const className = Array.from(element.classList).slice(0, 2).map((value) => `.${value}`).join('');
  return `${element.tagName.toLowerCase()}${id}${className}`;
}

function normalizeIncluded(elements: Element[], candidate: Element): Element[] {
  if (elements.includes(candidate)) return elements.filter((element) => element !== candidate);
  if (elements.some((element) => element.contains(candidate))) return elements;
  return [...elements.filter((element) => !candidate.contains(element)), candidate];
}

function isInsideIncluded(candidate: Element, included: Element[]): boolean {
  return included.some((element) => element === candidate || element.contains(candidate));
}

export function runSectionSelector(): Promise<SelectionResult | undefined> {
  const { host, root } = createHost();
  const style = document.createElement('style');
  style.textContent = baseStyles();
  root.append(style);

  const markers = document.createElement('div');
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Selector de secciones');
  panel.innerHTML = `
    <div class="row">
      <strong class="status" aria-live="polite">Modo incluir · 0 bloques</strong>
      <button class="secondary include" type="button">Incluir</button>
      <button class="secondary exclude" type="button">Excluir</button>
      <button class="secondary undo" type="button">Deshacer</button>
      <button class="danger cancel" type="button">Cancelar</button>
      <button class="primary preview-button" type="button">Vista previa</button>
    </div>
    <div class="hint">Pasa el cursor y haz clic en el contenido. Usa Excluir para quitar subbloques. Esc cancela.</div>
  `;
  root.append(markers, panel);

  let included: Element[] = [];
  let excluded: Element[] = [];
  let mode: 'include' | 'exclude' = 'include';
  let hover: Element | undefined;
  let showingPreview = false;
  const actions: Array<{ kind: 'include' | 'exclude'; before: Element[] }> = [];

  const status = panel.querySelector<HTMLElement>('.status')!;
  const includeButton = panel.querySelector<HTMLButtonElement>('.include')!;
  const excludeButton = panel.querySelector<HTMLButtonElement>('.exclude')!;
  const undoButton = panel.querySelector<HTMLButtonElement>('.undo')!;
  const cancelButton = panel.querySelector<HTMLButtonElement>('.cancel')!;
  const previewButton = panel.querySelector<HTMLButtonElement>('.preview-button')!;

  const updateStatus = (): void => {
    status.textContent = `Modo ${mode === 'include' ? 'incluir' : 'excluir'} · ${included.length} incluidos · ${excluded.length} excluidos`;
    includeButton.className = mode === 'include' ? 'primary include' : 'secondary include';
    excludeButton.className = mode === 'exclude' ? 'danger exclude' : 'secondary exclude';
    previewButton.disabled = included.length === 0;
  };

  const addMarker = (element: Element, className: string, title: string): void => {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const marker = document.createElement('div');
    marker.className = `marker ${className}`;
    marker.title = title;
    marker.style.cssText += `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`;
    markers.append(marker);
  };

  const renderMarkers = (): void => {
    markers.replaceChildren();
    included.forEach((element) => addMarker(element, '', `Incluido: ${describeSelectedElement(element)}`));
    excluded.forEach((element) => addMarker(element, 'exclude', `Excluido: ${describeSelectedElement(element)}`));
    if (hover && !included.includes(hover) && !excluded.includes(hover)) {
      addMarker(hover, 'hover', describeSelectedElement(hover));
    }
  };

  const targetAt = (event: MouseEvent): Element | undefined => {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!target || target === host || host.contains(target)) return undefined;
    return target;
  };

  const onPointerMove = (event: MouseEvent): void => {
    if (showingPreview) return;
    hover = targetAt(event);
    renderMarkers();
  };

  const onPageClick = (event: MouseEvent): void => {
    if (showingPreview || event.composedPath().includes(host)) return;
    const target = targetAt(event);
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    if (mode === 'include') {
      actions.push({ kind: 'include', before: included });
      included = normalizeIncluded(included, target);
      excluded = excluded.filter((element) => isInsideIncluded(element, included));
    } else if (isInsideIncluded(target, included)) {
      actions.push({ kind: 'exclude', before: excluded });
      excluded = excluded.includes(target)
        ? excluded.filter((element) => element !== target)
        : [...excluded.filter((element) => !target.contains(element)), target];
    }
    updateStatus();
    renderMarkers();
  };

  const onViewportChange = (): void => renderMarkers();

  return new Promise((resolve) => {
    const cleanup = (): void => {
      document.removeEventListener('mousemove', onPointerMove, true);
      document.removeEventListener('click', onPageClick, true);
      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange);
      document.removeEventListener('keydown', onKeyDown, true);
      host.remove();
    };

    const cancel = (): void => {
      cleanup();
      resolve(undefined);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancel();
    };

    const closePreview = (): void => {
      root.querySelector('.preview')?.remove();
      showingPreview = false;
      panel.style.display = '';
      renderMarkers();
    };

    const openPreview = (): void => {
      if (included.length === 0) return;
      showingPreview = true;
      hover = undefined;
      markers.replaceChildren();
      panel.style.display = 'none';
      const html = buildStyledSelectionHtml(included, excluded);
      const preview = document.createElement('section');
      preview.className = 'preview';
      preview.setAttribute('role', 'dialog');
      preview.setAttribute('aria-label', 'Vista previa de la selección');
      preview.innerHTML = `
        <header>
          <strong>Vista previa · ${included.length} incluidos · ${excluded.length} excluidos</strong>
          <button class="secondary back" type="button">Volver</button>
          <button class="primary save" type="button">Guardar vista</button>
        </header>
        <iframe title="Contenido seleccionado"></iframe>
      `;
      const frame = preview.querySelector<HTMLIFrameElement>('iframe')!;
      frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body>${html}</body></html>`;
      preview.querySelector<HTMLButtonElement>('.back')!.addEventListener('click', closePreview);
      preview.querySelector<HTMLButtonElement>('.save')!.addEventListener('click', () => {
        cleanup();
        resolve({ included, excluded, previewHtml: html });
      });
      root.append(preview);
      preview.querySelector<HTMLButtonElement>('.save')!.focus();
    };

    includeButton.addEventListener('click', () => {
      mode = 'include';
      updateStatus();
    });
    excludeButton.addEventListener('click', () => {
      mode = 'exclude';
      updateStatus();
    });
    undoButton.addEventListener('click', () => {
      const action = actions.pop();
      if (!action) return;
      if (action.kind === 'include') included = action.before;
      else excluded = action.before;
      excluded = excluded.filter((element) => isInsideIncluded(element, included));
      updateStatus();
      renderMarkers();
    });
    cancelButton.addEventListener('click', cancel);
    previewButton.addEventListener('click', openPreview);
    document.addEventListener('mousemove', onPointerMove, true);
    document.addEventListener('click', onPageClick, true);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);
    document.addEventListener('keydown', onKeyDown, true);
    updateStatus();
    includeButton.focus();
  });
}

export function confirmPreparedCapture(summary: PreparationSummary): Promise<boolean> {
  const { host, root } = createHost();
  const style = document.createElement('style');
  style.textContent = baseStyles();
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Confirmar captura');
  panel.innerHTML = `
    <div class="row">
      <div class="status">
        <strong>La página está preparada</strong><br>
        <span>${summary.scrollableAreas} áreas · ${summary.scrollSteps} pasos · ${Math.round(summary.finalDocumentHeight / 100) / 10} mil px</span>
      </div>
      <button class="danger cancel" type="button">Cancelar</button>
      <button class="primary save" type="button">Guardar vista</button>
    </div>
    <div class="hint">${summary.reachedLimit ? 'Se alcanzó el límite de preparación; revisa que esté todo lo que necesitas.' : 'El contenido dejó de crecer y el scroll original fue restaurado.'}</div>
  `;
  root.append(style, panel);

  return new Promise((resolve) => {
    const finish = (confirmed: boolean): void => {
      document.removeEventListener('keydown', onKeyDown, true);
      host.remove();
      resolve(confirmed);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') finish(false);
    };
    panel.querySelector<HTMLButtonElement>('.cancel')!.addEventListener('click', () => finish(false));
    panel.querySelector<HTMLButtonElement>('.save')!.addEventListener('click', () => finish(true));
    document.addEventListener('keydown', onKeyDown, true);
    panel.querySelector<HTMLButtonElement>('.save')!.focus();
  });
}

export function showPageToast(message: string, isError = false): void {
  const { host, root } = createHost();
  const toast = document.createElement('div');
  toast.setAttribute('role', isError ? 'alert' : 'status');
  toast.textContent = message;
  toast.style.cssText = `pointer-events:none;position:fixed;right:18px;top:18px;max-width:360px;padding:12px 16px;border-radius:10px;background:${isError ? '#991b1b' : '#0f172a'};color:#fff;box-shadow:0 12px 40px rgba(15,23,42,.3);font:600 14px/1.4 system-ui,sans-serif;`;
  root.append(toast);
  window.setTimeout(() => host.remove(), 3500);
}
