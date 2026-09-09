// Filename controls are intentionally removed together with Windows-reserved characters.
// eslint-disable-next-line no-control-regex
const INVALID_FILENAME = /[<>:"/\\|?*\u0000-\u001f]/g;
const REPEATED_DASH = /-+/g;

export function sanitizeFilename(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(INVALID_FILENAME, '-')
    .trim()
    .replace(/\s+/g, '-')
    .replace(REPEATED_DASH, '-')
    .replace(/^[.-]+|[.-]+$/g, '');

  return normalized.slice(0, 100) || 'coleccion-web';
}

export function buildPdfFilename(collectionName: string, date = new Date()): string {
  return `${sanitizeFilename(collectionName)}_${date.toISOString().slice(0, 10)}.pdf`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
