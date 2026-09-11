export const MAX_COLLECTION_BYTES = 300 * 1024 * 1024;

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
  current: { bytesUsed: number },
  incomingBytes: number,
): void {
  if (current.bytesUsed + incomingBytes > MAX_COLLECTION_BYTES) {
    throw new CollectionLimitError(
      'byte-limit',
      'La captura superaría el límite de 300 MB de la colección.',
    );
  }
}
