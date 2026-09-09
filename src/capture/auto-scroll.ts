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
const MAX_STEPS = 50;
const SETTLE_MS = 250;

function findScrollTargets(): ScrollTarget[] {
  const documentScroller = document.scrollingElement;
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('body *'))
    .filter((element) => {
      const style = getComputedStyle(element);
      return (
        element.scrollHeight > element.clientHeight + 24 &&
        ['auto', 'scroll'].includes(style.overflowY)
      );
    })
    .toSorted(
      (a, b) =>
        b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight),
    )
    .slice(0, 8);

  const elements = documentScroller
    ? [documentScroller, ...candidates.filter((element) => element !== documentScroller)]
    : candidates;
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
