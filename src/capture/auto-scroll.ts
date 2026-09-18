export interface PreparationSummary {
  elapsedMs: number;
  scrollSteps: number;
  scrollableAreas: number;
  finalDocumentHeight: number;
  reachedLimit: boolean;
}
interface ScrollTarget {
  element: Element;
  initialTop: number;
}

const MAX_DURATION_MS = 30_000;
// devwf: techo conocido — 35 pasos x ~120ms cubre lazy-load típico; páginas
// infinitas quedan marcadas con reachedLimit en vez de bloquear la captura.
const MAX_STEPS = 35;
const SETTLE_MS = 120;

function isVerticallyScrollable(element: HTMLElement): boolean {
  // Filtro barato primero (solo geometría); getComputedStyle solo a candidatos.
  if (element.scrollHeight <= element.clientHeight + 24) return false;
  const style = getComputedStyle(element);
  return style.overflowY === 'auto' || style.overflowY === 'scroll';
}

function findScrollTargets(): ScrollTarget[] {
  const documentScroller = document.scrollingElement;
  // TreeWalker evita materializar `body *` con querySelectorAll en páginas grandes.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  const candidates: HTMLElement[] = [];
  let node = walker.nextNode() as HTMLElement | null;
  while (node) {
    if (node !== documentScroller && isVerticallyScrollable(node)) {
      candidates.push(node);
    }
    node = walker.nextNode() as HTMLElement | null;
  }
  candidates.sort(
    (a, b) =>
      b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight),
  );

  const top = candidates.slice(0, 8);

  const elements = documentScroller
    ? [documentScroller, ...top.filter((element) => element !== documentScroller)]
    : top;
  return elements.map((element) => ({ element, initialTop: element.scrollTop }));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export async function prepareDynamicContent(): Promise<PreparationSummary> {
  const startedAt = performance.now();
  const targets = findScrollTargets();
  let scrollSteps = 0;
  let stableChecks = 0;
  let previousHeight = document.documentElement.scrollHeight;

  try {
    while (
      performance.now() - startedAt < MAX_DURATION_MS &&
      scrollSteps < MAX_STEPS &&
      stableChecks < 3
    ) {
      let moved = false;
      for (const { element } of targets) {
        const remaining = element.scrollHeight - element.clientHeight - element.scrollTop;
        if (remaining <= 1) continue;
        element.scrollTop = Math.min(
          element.scrollTop + Math.max(200, element.clientHeight * 0.85),
          element.scrollHeight,
        );
        moved = true;
      }

      scrollSteps += 1;
      await delay(SETTLE_MS);
      const currentHeight = document.documentElement.scrollHeight;
      stableChecks = !moved && currentHeight === previousHeight ? stableChecks + 1 : 0;
      previousHeight = currentHeight;
    }

    return {
      elapsedMs: Math.round(performance.now() - startedAt),
      scrollSteps,
      scrollableAreas: targets.length,
      finalDocumentHeight: document.documentElement.scrollHeight,
      reachedLimit:
        scrollSteps >= MAX_STEPS || performance.now() - startedAt >= MAX_DURATION_MS,
    };
  } finally {
    for (const target of targets) target.element.scrollTop = target.initialTop;
  }
}
