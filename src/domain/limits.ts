const MEBIBYTE = 1024 * 1024;

export const COLLECTION_LIMIT_OPTIONS = [
  100 * MEBIBYTE,
  300 * MEBIBYTE,
  500 * MEBIBYTE,
  1024 * MEBIBYTE,
] as const;

export const DEFAULT_COLLECTION_LIMIT_BYTES = COLLECTION_LIMIT_OPTIONS[1];

export function isCollectionLimitBytes(value: number): boolean {
  return COLLECTION_LIMIT_OPTIONS.some((option) => option === value);
}

export class CollectionLimitError extends Error {
  constructor(
    public readonly code: 'byte-limit',
    message: string,
  ) {
    super(message);
    this.name = 'CollectionLimitError';
  }
}

export function assertCollectionCapacity(
  current: { bytesUsed: number; storageLimitBytes: number },
  incomingBytes: number,
): void {
  if (current.bytesUsed + incomingBytes > current.storageLimitBytes) {
    throw new CollectionLimitError(
      'byte-limit',
      'La captura superaría el límite local configurado para la colección.',
    );
  }
}
