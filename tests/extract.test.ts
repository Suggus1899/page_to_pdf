import { beforeEach, describe, expect, it } from 'vitest';
import { extractSemanticDocument } from '../src/capture/extract';

describe('extracción semántica', () => {
  beforeEach(() => {
    history.replaceState({}, '', '/docs?state=one');
    document.documentElement.lang = 'es';
    document.title = 'Guía de prueba';
    document.body.innerHTML = `
      <nav>Menú que debe omitirse</nav>
      <main id="article">
        <h1>Introducción</h1>
        <p>Texto principal con <a href="/referencia">una referencia</a>.</p>
        <ul><li>Primero</li><li>Segundo</li></ul>
        <table><thead><tr><th>Clave</th><th>Valor</th></tr></thead>
          <tbody><tr><td>A</td><td>1</td></tr></tbody></table>
        <pre>const answer = 42;</pre>
        <label>Ciudad <input name="city" value="Caracas"></label>
        <input aria-label="Secreto" type="password" value="no-exportar">
        <iframe title="Ejemplo externo" src="https://other.test/embed"></iframe>
        <p id="private">Contenido excluido</p>
        <p hidden>No visible</p>
      </main>
      <aside>Publicidad omitida</aside>
    `;
  });

  it('normaliza contenido útil y conserva metadatos de la vista', async () => {
    const root = document.querySelector('#article');
    const excluded = document.querySelector('#private');
    if (!root || !excluded) throw new Error('Fixture inválido');

    const result = await extractSemanticDocument(
      [root],
      [excluded],
      { kind: 'selection', included: ['main#article'], excluded: ['p#private'] },
    );
    const serialized = JSON.stringify(result.document.blocks);

    expect(result.title).toBe('Guía de prueba');
    expect(result.url).toBe('https://example.test/docs?state=one');
    expect(result.scope).toEqual({
      kind: 'selection',
      included: ['main#article'],
      excluded: ['p#private'],
    });
    expect(result.document.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'heading', level: 1, text: 'Introducción' }),
        expect.objectContaining({ type: 'list', ordered: false, items: ['Primero', 'Segundo'] }),
        expect.objectContaining({ type: 'table', headerRows: 1 }),
        expect.objectContaining({ type: 'code', text: 'const answer = 42;' }),
      ]),
    );
    expect(serialized).toContain('https://example.test/referencia');
    expect(serialized).toContain('Ciudad: Caracas');
    expect(serialized).toContain('Contenido incrustado no capturado');
    expect(serialized).not.toContain('no-exportar');
    expect(serialized).not.toContain('Contenido excluido');
    expect(serialized).not.toContain('No visible');
    expect(serialized).not.toContain('Publicidad omitida');
  });

  it('avisa cuando no encuentra bloques legibles', async () => {
    document.body.innerHTML = '<main><script>ignored()</script></main>';
    const root = document.querySelector('main');
    if (!root) throw new Error('Fixture inválido');
    const result = await extractSemanticDocument([root], [], { kind: 'full-page' });
    expect(result.document.blocks).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  });
});
