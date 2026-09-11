import { beforeEach, describe, expect, it } from 'vitest';
import type { CapturePayload } from '../src/domain/types';
import {
  assertCollectionCapacity,
  MAX_COLLECTION_BYTES,
} from '../src/domain/limits';
import {
  addCapture,
  clearAllData,
  createCollection,
  deleteCaptureItem,
  ensureDefaultCollection,
  getCollection,
  getReadableArtifact,
  listCaptureItems,
  listCollections,
  reorderCaptureItems,
} from '../src/storage/database';

function payload(title: string): CapturePayload {
  const capturedAt = new Date().toISOString();
  return {
    title,
    url: 'https://example.test/app',
    capturedAt,
    viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
    scope: { kind: 'full-page' },
    warnings: [],
    document: {
      schemaVersion: 1,
      title,
      url: 'https://example.test/app',
      capturedAt,
      language: 'es',
      blocks: [{ type: 'paragraph', text: 'Estado ' + title, links: [] }],
    },
  };
}

describe('persistencia de colecciones', () => {
  beforeEach(async () => {
    await clearAllData();
  });

  it('conserva estados distintos aunque compartan la misma URL', async () => {
    const collection = await createCollection('SPA');
    expect(collection.captureFaithful).toBe(true);
    const first = await addCapture(collection.id, payload('Estado A'));
    const second = await addCapture(collection.id, payload('Estado B'));

    const items = await listCaptureItems(collection.id);
    expect(items.map((item) => item.title)).toEqual(['Estado A', 'Estado B']);
    expect(first.id).not.toBe(second.id);
    expect(items[0]?.url).toBe(items[1]?.url);
    expect((await getReadableArtifact(first.id))?.data.blocks).toHaveLength(1);
  });

  it('crea una sola colección inicial ante llamadas simultáneas', async () => {
    const defaults = await Promise.all([
      ensureDefaultCollection(),
      ensureDefaultCollection(),
      ensureDefaultCollection(),
    ]);
    expect(new Set(defaults.map((entry) => entry.id))).toEqual(new Set(['default']));
    expect(defaults.every((entry) => entry.captureFaithful)).toBe(true);
    await expect(listCollections()).resolves.toHaveLength(1);
  });

  it('reordena y compacta posiciones al eliminar', async () => {
    const collection = await createCollection('Orden');
    const a = await addCapture(collection.id, payload('A'));
    const b = await addCapture(collection.id, payload('B'));
    const c = await addCapture(collection.id, payload('C'));

    await reorderCaptureItems(collection.id, [c.id, a.id, b.id]);
    expect((await listCaptureItems(collection.id)).map((item) => item.title)).toEqual(['C', 'A', 'B']);

    await deleteCaptureItem(a.id);
    const remaining = await listCaptureItems(collection.id);
    expect(remaining.map((item) => [item.title, item.position])).toEqual([
      ['C', 0],
      ['B', 1],
    ]);
    expect((await getCollection(collection.id))?.itemCount).toBe(2);
  });

  it('no limita la cantidad de vistas mientras haya espacio', async () => {
    const collection = await createCollection('Sin límite de vistas');
    for (let index = 0; index < 51; index += 1) {
      await addCapture(collection.id, payload('Vista ' + index));
    }

    expect((await getCollection(collection.id))?.itemCount).toBe(51);
    expect(await listCaptureItems(collection.id)).toHaveLength(51);
  });

  it('bloquea una captura antes de superar 300 MB', () => {
    expect(() =>
      assertCollectionCapacity(
        { bytesUsed: MAX_COLLECTION_BYTES - 10 },
        11,
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'byte-limit' }),
    );
    expect(() =>
      assertCollectionCapacity(
        { bytesUsed: MAX_COLLECTION_BYTES - 10 },
        10,
      ),
    ).not.toThrow();
  });
});
