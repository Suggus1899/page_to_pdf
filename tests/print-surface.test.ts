import { describe, expect, it } from 'vitest';
import {
  buildStyledSelectionHtml,
  installPrintSurface,
} from '../src/capture/print-surface';

describe('superficie fiel temporal', () => {
  it('clona inclusiones, omite exclusiones y sanea manejadores', () => {
    document.body.innerHTML = `
      <article id="root" onclick="alert(1)">
        <h1>Conservar</h1>
        <p id="omit">Excluir</p>
        <iframe title="Externo" src="https://other.test/embed"></iframe>
        <script>danger()</script>
      </article>
    `;
    const root = document.querySelector('#root');
    const omitted = document.querySelector('#omit');
    if (!root || !omitted) throw new Error('Fixture inválido');

    const html = buildStyledSelectionHtml([root], [omitted]);
    expect(html).toContain('Conservar');
    expect(html).not.toContain('Excluir');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('danger()');
    expect(html).toContain('Contenido incrustado no capturado');
    expect(html).not.toContain('<iframe');
  });

  it('instala y limpia todos los cambios aunque falle la captura', () => {
    document.body.innerHTML = '<article id="original">Original</article>';
    const cleanup = installPrintSurface('<main>Vista temporal</main>');

    expect(document.body.textContent).toContain('Vista temporal');
    expect(document.querySelector('[aria-label="Superficie temporal de impresión"]')).toBeInTheDocument();
    expect(document.head.nextElementSibling ?? document.documentElement).toBeTruthy();

    cleanup();
    expect(document.querySelector('[aria-label="Superficie temporal de impresión"]')).not.toBeInTheDocument();
    expect(document.body.textContent).toBe('Original');
  });
});
