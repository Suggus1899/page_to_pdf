import { describe, expect, it } from 'vitest';
import { buildPdfFilename, formatBytes, sanitizeFilename } from '../src/utils/filename';

describe('nombres de archivo', () => {
  it('elimina acentos, caracteres reservados y espacios', () => {
    expect(sanitizeFilename('  Investigación: año/2026  ')).toBe('Investigacion-ano-2026');
  });

  it('usa un nombre seguro si la entrada queda vacía', () => {
    expect(sanitizeFilename('...')).toBe('coleccion-web');
  });

  it('agrega la fecha ISO sin depender de la zona horaria', () => {
    expect(buildPdfFilename('Mi colección', new Date('2026-09-09T15:00:00Z'))).toBe(
      'Mi-coleccion_2026-09-09.pdf',
    );
  });

  it('formatea el tamaño visible', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});
