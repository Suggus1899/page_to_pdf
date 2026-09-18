import { deleteDB, openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_COLLECTION_LIMIT_BYTES } from '../src/domain/limits';

const DATABASE_NAME = 'collection-web-pdf';

async function seedLegacyDatabase(version: 1 | 2, pending: boolean): Promise<void> {
  const database = await openDB(DATABASE_NAME, version, {
    upgrade(db) {
      const collections = db.createObjectStore('collections', { keyPath: 'id' });
      collections.createIndex('by-updated', 'updatedAt');
      const items = db.createObjectStore('items', { keyPath: 'id' });
      items.createIndex('by-collection', 'collectionId');
      items.createIndex('by-collection-position', ['collectionId', 'position']);
      if (version === 2) items.createIndex('by-status', 'status');
      const artifacts = db.createObjectStore('artifacts', { keyPath: 'id' });
      artifacts.createIndex('by-item', 'itemId');
      artifacts.createIndex('by-collection', 'collectionId');
    },
  });

  const transaction = database.transaction(['collections', 'items', 'artifacts'], 'readwrite');
  const capturedAt = '2026-09-10T12:00:00.000Z';
  await transaction.objectStore('collections').put({
    id: 'legacy',
    name: 'Colección anterior',
    createdAt: capturedAt,
    updatedAt: capturedAt,
    itemCount: 1,
    bytesUsed: 256,
    status: 'ready',
    captureFaithful: true,
    printSettings: {
      paper: 'letter',
      orientation: 'portrait',
      marginInches: 0.5,
      scale: 1,
      printBackground: true,
    },
  });
  await transaction.objectStore('items').put({
    id: 'legacy-item',
    collectionId: 'legacy',
    position: 0,
    title: 'Vista anterior',
    url: 'https://example.test',
    capturedAt,
    viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
    scope: { kind: 'full-page' },
    status: pending ? 'quota-pending' : 'ready',
    ...(pending ? { quotaReservationId: 'legacy-reservation' } : {}),
    readableAvailable: true,
    faithfulAvailable: false,
    bytesUsed: 256,
    warnings: [],
  });
  await transaction.objectStore('artifacts').put({
    id: 'legacy-item:readable',
    itemId: 'legacy-item',
    collectionId: 'legacy',
    kind: 'readable',
    bytes: 256,
    data: {
      schemaVersion: 1,
      title: 'Vista anterior',
      url: 'https://example.test',
      capturedAt,
      language: 'es',
      blocks: [{ type: 'paragraph', text: 'Contenido conservado', links: [] }],
    },
  });
  await transaction.done;
  database.close();
}

describe('migración IndexedDB v3', () => {
  beforeEach(async () => {
    vi.resetModules();
    await deleteDB(DATABASE_NAME);
  });

  afterEach(async () => {
    await deleteDB(DATABASE_NAME);
  });

  it.each([
    { version: 1 as const, pending: false },
    { version: 2 as const, pending: true },
  ])('migra v$version sin perder capturas', async ({ version, pending }) => {
    await seedLegacyDatabase(version, pending);
    const storage = await import('../src/storage/database');

    await expect(storage.getCollection('legacy')).resolves.toMatchObject({
      storageLimitBytes: DEFAULT_COLLECTION_LIMIT_BYTES,
    });
    const [item] = await storage.listCaptureItems('legacy');
    expect(item).toMatchObject({ status: 'ready', title: 'Vista anterior' });
    expect(item).not.toHaveProperty('quotaReservationId');
    await expect(storage.getReadableArtifact('legacy-item')).resolves.toMatchObject({
      data: { blocks: [{ text: 'Contenido conservado' }] },
    });

    const migrated = await openDB(DATABASE_NAME);
    expect(migrated.version).toBe(3);
    expect(migrated.transaction('items').store.indexNames.contains('by-status')).toBe(false);
    migrated.close();
  });
});
