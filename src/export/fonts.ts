import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';

// Subset latino decidido con el usuario: solo Regular + Medium (normal/negrita).
// Las itálicas se mapean a sus equivalentes rectas para no cargar
// Roboto-Italic/MediumItalic (~50% del vfs) sin romper los estilos
// `italics:true` que usa el perfil legible (citas, h6).
const KEEP = ['Roboto-Regular.ttf', 'Roboto-Medium.ttf'] as const;

function sourceVfs(): Record<string, string> {
  const record = pdfFonts as unknown as Record<string, unknown>;
  if (typeof record !== 'object' || record === null) return {};
  const nested = record['pdfMake'] as { vfs?: unknown } | undefined;
  if (nested && typeof nested === 'object' && nested.vfs && typeof nested.vfs === 'object') {
    return nested.vfs as Record<string, string>;
  }
  const vfs = record['vfs'];
  if (vfs && typeof vfs === 'object') return vfs as Record<string, string>;
  return record as unknown as Record<string, string>;
}

let installed = false;

export function installSubsetFonts(): void {
  if (installed) return;
  installed = true;
  const source = sourceVfs();
  const vfs: Record<string, string> = {};
  for (const name of KEEP) {
    const data = source[name];
    if (typeof data === 'string') vfs[name] = data;
  }
  pdfMake.vfs = vfs;
  pdfMake.fonts = {
    Roboto: {
      normal: 'Roboto-Regular.ttf',
      bold: 'Roboto-Medium.ttf',
      italics: 'Roboto-Regular.ttf',
      bolditalics: 'Roboto-Medium.ttf',
    },
  };
}
