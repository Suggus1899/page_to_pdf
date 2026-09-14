import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  DEFAULT_PRINT_SETTINGS,
  type CaptureArtifact,
  type CaptureItem,
  type CapturePayload,
  type CollectionDraft,
  type PrintSettings,
  type SemanticDocument,
} from '../domain/types';
import {
  assertCollectionCapacity,
} from '../domain/limits';

interface CollectionWebDb extends DBSchema {
  collections: {
    key: string;
    value: CollectionDraft;
    indexes: { 'by-updated': string };
  };
  items: {
    key: string;
    value: CaptureItem;
    indexes: {
      'by-collection': string;
      'by-collection-position': [string, number];
      'by-status': string;
    };
  };
  artifacts: {
    key: string;
    value: CaptureArtifact;
    indexes: { 'by-item': string; 'by-collection': string };
  };
}

let databasePromise: Promise<IDBPDatabase<CollectionWebDb>> | undefined;

function getDatabase(): Promise<IDBPDatabase<CollectionWebDb>> {
  databasePromise ??= openDB<CollectionWebDb>('collection-web-pdf', 2, {
    upgrade(database, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
        const collections = database.createObjectStore('collections', { keyPath: 'id' });
        collections.createIndex('by-updated', 'updatedAt');

        const items = database.createObjectStore('items', { keyPath: 'id' });
        items.createIndex('by-collection', 'collectionId');
        items.createIndex('by-collection-position', ['collectionId', 'position']);
        items.createIndex('by-status', 'status');

        const artifacts = database.createObjectStore('artifacts', { keyPath: 'id' });
        artifacts.createIndex('by-item', 'itemId');
        artifacts.createIndex('by-collection', 'collectionId');
        return;
      }
      // v2: índice por estado para no escanear todos los items en reconcile.
      if (oldVersion < 2) {
        const itemStore = transaction.objectStore('items');
        if (!itemStore.indexNames.contains('by-status')) {
          itemStore.createIndex('by-status', 'status');
        }
      }
    },
  });
  return databasePromise;
}

function semanticBytes(document: SemanticDocument): number {
  return new TextEncoder().encode(JSON.stringify(document)).byteLength;
}

export function captureBytes(payload: CapturePayload, faithfulPdf?: ArrayBuffer): number {
  return semanticBytes(payload.document) + (faithfulPdf?.byteLength ?? 0);
}

export async function listCollections(): Promise<CollectionDraft[]> {
  const database = await getDatabase();
  // El índice by-updated evita ordenar en JS; revierte para mostrar recientes primero.
  const collections = await database.getAllFromIndex('collections', 'by-updated');
  return collections.reverse();
}

export async function getCollection(id: string): Promise<CollectionDraft | undefined> {
  return (await getDatabase()).get('collections', id);
}

export async function getReadableArtifact(
  itemId: string,
): Promise<CaptureArtifact<SemanticDocument> | undefined> {
  const artifact = await (await getDatabase()).get('artifacts', `${itemId}:readable`);
  return artifact as CaptureArtifact<SemanticDocument> | undefined;
}

export async function getFaithfulArtifact(
  itemId: string,
): Promise<CaptureArtifact<ArrayBuffer> | undefined> {
  const artifact = await (await getDatabase()).get('artifacts', `${itemId}:faithful`);
  return artifact as CaptureArtifact<ArrayBuffer> | undefined;
}

export async function createCollection(name: string): Promise<CollectionDraft> {
  const now = new Date().toISOString();
  const collection: CollectionDraft = {
    id: crypto.randomUUID(),
    name: name.trim() || 'Mi colección',
    createdAt: now,
    updatedAt: now,
    itemCount: 0,
    bytesUsed: 0,
    status: 'ready',
    captureFaithful: true,
    printSettings: { ...DEFAULT_PRINT_SETTINGS },
  };
  await (await getDatabase()).put('collections', collection);
  return collection;
}

export async function ensureDefaultCollection(): Promise<CollectionDraft> {
  const database = await getDatabase();
  const transaction = database.transaction('collections', 'readwrite');
  const store = transaction.objectStore('collections');
  const existing = await store.getAll();
  if (existing.length > 0) {
    await transaction.done;
    return existing.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]!;
  }

  const now = new Date().toISOString();
  const collection: CollectionDraft = {
    id: 'default',
    name: 'Mi primera colección',
    createdAt: now,
    updatedAt: now,
    itemCount: 0,
    bytesUsed: 0,
    status: 'ready',
    captureFaithful: true,
    printSettings: { ...DEFAULT_PRINT_SETTINGS },
  };
  await store.add(collection);
  await transaction.done;
  return collection;
}

export async function updateCollection(
  id: string,
  patch: Partial<Pick<CollectionDraft, 'name' | 'captureFaithful'>> & {
    printSettings?: Partial<PrintSettings>;
  },
): Promise<CollectionDraft> {
  const database = await getDatabase();
  const collection = await database.get('collections', id);
  if (!collection) throw new Error('La colección ya no existe.');

  const updated: CollectionDraft = {
    ...collection,
    ...patch,
    name: patch.name?.trim() || collection.name,
    printSettings: {
      ...collection.printSettings,
      ...patch.printSettings,
    },
    updatedAt: new Date().toISOString(),
  };
  await database.put('collections', updated);
  return updated;
}

export async function listCaptureItems(collectionId: string): Promise<CaptureItem[]> {
  const database = await getDatabase();
  const items = await database.getAllFromIndex('items', 'by-collection', collectionId);
  return items.toSorted((a, b) => a.position - b.position);
}

export async function addCapture(
  collectionId: string,
  payload: CapturePayload,
  faithfulPdf?: ArrayBuffer,
  quota?: { reservationId: string; bytes?: number },
): Promise<CaptureItem> {
  const database = await getDatabase();
  const transaction = database.transaction(
    ['collections', 'items', 'artifacts'],
    'readwrite',
  );
  const collection = await transaction.objectStore('collections').get(collectionId);
  if (!collection) throw new Error('La colección ya no existe.');
  // Un solo JSON.stringify por captura: reutiliza los bytes ya reservados cuando
  // el coordinador los calculó para la cuota en vez de serializar dos veces.
  const readableBytes = semanticBytes(payload.document);
  const faithfulBytes = faithfulPdf?.byteLength ?? 0;
  const bytesUsed = quota?.bytes ?? readableBytes + faithfulBytes;
  assertCollectionCapacity(collection, bytesUsed);

  const itemId = crypto.randomUUID();
  const item: CaptureItem = {
    id: itemId,
    collectionId,
    position: collection.itemCount,
    title: payload.title,
    url: payload.url,
    capturedAt: payload.capturedAt,
    viewport: payload.viewport,
    scope: payload.scope,
    status: quota ? 'quota-pending' : 'ready',
    ...(quota ? { quotaReservationId: quota.reservationId } : {}),
    readableAvailable: true,
    faithfulAvailable: Boolean(faithfulPdf),
    bytesUsed,
    warnings: payload.warnings,
  };

  const readableArtifact: CaptureArtifact<SemanticDocument> = {
    id: `${itemId}:readable`,
    itemId,
    collectionId,
    kind: 'readable',
    bytes: readableBytes,
    data: payload.document,
  };
  await transaction.objectStore('items').add(item);
  await transaction.objectStore('artifacts').add(readableArtifact);

  if (faithfulPdf) {
    const faithfulArtifact: CaptureArtifact<ArrayBuffer> = {
      id: `${itemId}:faithful`,
      itemId,
      collectionId,
      kind: 'faithful',
      bytes: faithfulBytes,
      data: faithfulPdf,
    };
    await transaction.objectStore('artifacts').add(faithfulArtifact);
  }

  await transaction.objectStore('collections').put({
    ...collection,
    itemCount: collection.itemCount + 1,
    bytesUsed: collection.bytesUsed + bytesUsed,
    updatedAt: new Date().toISOString(),
  });
  await transaction.done;
  return item;
}

export async function markCaptureReady(itemId: string): Promise<CaptureItem> {
  const database = await getDatabase();
  const item = await database.get('items', itemId);
  if (!item) throw new Error('La vista pendiente ya no existe.');
  const ready: CaptureItem = { ...item, status: 'ready' };
  delete ready.quotaReservationId;
  await database.put('items', ready);
  return ready;
}

export async function listPendingCaptureItems(): Promise<CaptureItem[]> {
  const database = await getDatabase();
  const pending = await database.getAllFromIndex('items', 'by-status', 'quota-pending');
  return pending.filter((item) => Boolean(item.quotaReservationId));
}

export async function renameCaptureItem(itemId: string, title: string): Promise<void> {
  const database = await getDatabase();
  const item = await database.get('items', itemId);
  if (!item) throw new Error('La vista ya no existe.');
  await database.put('items', { ...item, title: title.trim() || item.title });
}

export async function reorderCaptureItems(
  collectionId: string,
  orderedIds: string[],
): Promise<void> {
  const database = await getDatabase();
  const transaction = database.transaction(['items', 'collections'], 'readwrite');
  const items = await transaction.objectStore('items').index('by-collection').getAll(collectionId);
  const currentIds = new Set(items.map((item) => item.id));
  if (currentIds.size !== orderedIds.length || orderedIds.some((id) => !currentIds.has(id))) {
    throw new Error('El orden recibido no coincide con las vistas de la colección.');
  }

  const itemMap = new Map(items.map((item) => [item.id, item]));
  const itemStore = transaction.objectStore('items');
  for (const [position, id] of orderedIds.entries()) {
    const item = itemMap.get(id);
    if (!item) throw new Error('La vista ya no existe.');
    // Solo escribe las filas que cambian de posición (reordenar 1 item de N
    // no debe reescribir N filas).
    if (item.position !== position) await itemStore.put({ ...item, position });
  }

  const collection = await transaction.objectStore('collections').get(collectionId);
  if (collection) {
    await transaction.objectStore('collections').put({
      ...collection,
      updatedAt: new Date().toISOString(),
    });
  }
  await transaction.done;
}

export async function deleteCaptureItem(itemId: string): Promise<void> {
  const database = await getDatabase();
  const transaction = database.transaction(
    ['collections', 'items', 'artifacts'],
    'readwrite',
  );
  const item = await transaction.objectStore('items').get(itemId);
  if (!item) return;

  const artifacts = await transaction.objectStore('artifacts').index('by-item').getAll(itemId);
  await Promise.all(artifacts.map((artifact) => transaction.objectStore('artifacts').delete(artifact.id)));
  await transaction.objectStore('items').delete(itemId);

  const remaining = await transaction
    .objectStore('items')
    .index('by-collection')
    .getAll(item.collectionId);
  const itemStore = transaction.objectStore('items');
  for (const [position, entry] of remaining
    .toSorted((a, b) => a.position - b.position)
    .entries()) {
    if (entry.position !== position) await itemStore.put({ ...entry, position });
  }

  const collection = await transaction.objectStore('collections').get(item.collectionId);
  if (collection) {
    await transaction.objectStore('collections').put({
      ...collection,
      itemCount: Math.max(0, collection.itemCount - 1),
      bytesUsed: Math.max(0, collection.bytesUsed - item.bytesUsed),
      updatedAt: new Date().toISOString(),
    });
  }
  await transaction.done;
}

export async function deleteCollection(collectionId: string): Promise<void> {
  const database = await getDatabase();
  const transaction = database.transaction(
    ['collections', 'items', 'artifacts'],
    'readwrite',
  );
  const items = await transaction.objectStore('items').index('by-collection').getAll(collectionId);
  const artifacts = await transaction
    .objectStore('artifacts')
    .index('by-collection')
    .getAll(collectionId);
  await Promise.all(items.map((item) => transaction.objectStore('items').delete(item.id)));
  await Promise.all(artifacts.map((artifact) => transaction.objectStore('artifacts').delete(artifact.id)));
  await transaction.objectStore('collections').delete(collectionId);
  await transaction.done;
}

export async function clearAllData(): Promise<void> {
  const database = await getDatabase();
  const transaction = database.transaction(
    ['collections', 'items', 'artifacts'],
    'readwrite',
  );
  await Promise.all([
    transaction.objectStore('collections').clear(),
    transaction.objectStore('items').clear(),
    transaction.objectStore('artifacts').clear(),
  ]);
  await transaction.done;
}
