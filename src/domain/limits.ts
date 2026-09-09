export const MAX_COLLECTION_ITEMS = 50;
export const MAX_COLLECTION_BYTES = 250 * 1024 * 1024;

export class CollectionLimitError extends Error {
  constructor(
    public readonly code: 'item-limit' | 'byte-limit',
    message: string,
  ) {
    super(message);
    this.name = 'CollectionLimitError';
  }
}

export function assertCollectionCapacity(
  current: { itemCount: number; bytesUsed: number },
  incomingBytes: number,
): void {
  if (current.itemCount >= MAX_COLLECTION_ITEMS) {
    throw new CollectionLimitError(
      'item-limit',
      `La colección alcanzó el límite de ${MAX_COLLECTION_ITEMS} vistas.`,
    );
  }
  if (current.bytesUsed + incomingBytes > MAX_COLLECTION_BYTES) {
    throw new CollectionLimitError(
      'byte-limit',
      'La captura superaría el límite de 250 MB de la colección.',
    );
  }
}
