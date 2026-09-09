import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareDynamicContent } from '../src/capture/auto-scroll';

describe('preparación de contenido dinámico', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('recorre áreas largas y restaura su posición original', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="scrollable" style="overflow-y:auto"></div>';
    const element = document.querySelector<HTMLElement>('#scrollable');
    if (!element) throw new Error('Fixture inválido');
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(element, 'clientHeight', { configurable: true, value: 100 });
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 1200,
    });
    element.scrollTop = 75;

    const preparation = prepareDynamicContent();
    await vi.runAllTimersAsync();
    const summary = await preparation;

    expect(summary.scrollableAreas).toBe(1);
    expect(summary.scrollSteps).toBeGreaterThan(1);
    expect(element.scrollTop).toBe(75);
    expect(summary.reachedLimit).toBe(false);
  });
});
