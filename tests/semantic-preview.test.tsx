import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SemanticPreview } from '../entrypoints/manager/SemanticPreview';
import type { SemanticDocument } from '../src/domain/types';

describe('vista previa legible', () => {
  it('renderiza estructura, vínculos, código y texto alternativo', () => {
    const document: SemanticDocument = {
      schemaVersion: 1,
      title: 'Vista guardada',
      url: 'https://example.test/article',
      capturedAt: '2026-09-09T12:00:00.000Z',
      language: 'es',
      blocks: [
        { type: 'heading', level: 2, text: 'Sección', links: [] },
        { type: 'list', ordered: true, items: ['Uno', 'Dos'] },
        { type: 'code', text: 'const ok = true;' },
        { type: 'figure', alt: 'Diagrama accesible' },
        { type: 'link', label: 'Fuente', url: 'https://example.test/source' },
      ],
    };

    render(<SemanticPreview document={document} />);

    expect(screen.getByRole('heading', { name: 'Vista guardada' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Sección' })).toBeVisible();
    expect(screen.getByText('const ok = true;')).toBeVisible();
    expect(screen.getByText('Diagrama accesible')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Fuente' })).toHaveAttribute(
      'href',
      'https://example.test/source',
    );
  });
});
