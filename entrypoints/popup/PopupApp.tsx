import { useCallback, useEffect, useState } from 'react';
import type { CollectionDraft } from '../../src/domain/types';
import { copy } from '../../src/i18n/es';
import {
  MESSAGE_PROTOCOL_VERSION,
  type RuntimeMessage,
  type RuntimeResponse,
} from '../../src/runtime/messages';
import {
  createCollection,
  ensureDefaultCollection,
  listCollections,
  updateCollection,
} from '../../src/storage/database';
import { formatBytes } from '../../src/utils/filename';

const ACTIVE_COLLECTION_KEY = 'activeCollectionId';

export function PopupApp() {
  const [collections, setCollections] = useState<CollectionDraft[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean }>();

  const reportError = useCallback((error: unknown): void => {
    setMessage({
      text: error instanceof Error ? error.message : 'No se pudo completar la acción.',
      error: true,
    });
  }, []);

  const runAction = useCallback((action: () => Promise<void>): void => {
    void action().catch(reportError);
  }, [reportError]);

  const refresh = useCallback(async () => {
    const [saved, stored] = await Promise.all([
      listCollections(),
      browser.storage.local.get(ACTIVE_COLLECTION_KEY),
    ]);
    let next = saved;
    if (next.length === 0) next = [await ensureDefaultCollection()];
    const storedId =
      typeof stored[ACTIVE_COLLECTION_KEY] === 'string'
        ? stored[ACTIVE_COLLECTION_KEY]
        : '';
    const active = next.some((collection) => collection.id === storedId)
      ? storedId
      : next[0]!.id;
    setCollections(next);
    setSelectedId(active);
  }, []);

  useEffect(() => {
    runAction(refresh);
  }, [refresh, runAction]);

  const selected = collections.find((collection) => collection.id === selectedId);

  const selectCollection = async (id: string): Promise<void> => {
    setSelectedId(id);
    await browser.storage.local.set({ [ACTIVE_COLLECTION_KEY]: id });
  };

  const addCollection = async (): Promise<void> => {
    const collection = await createCollection(newName);
    setNewName('');
    await selectCollection(collection.id);
    await refresh();
  };

  const toggleFaithful = async (enabled: boolean): Promise<void> => {
    if (!selected) return;
    if (enabled) {
      const granted = await chrome.permissions.request({ permissions: ['debugger'] });
      if (!granted) {
        setMessage({
          text: 'Permiso denegado. El modo legible continúa disponible.',
          error: true,
        });
        return;
      }
    }
    await updateCollection(selected.id, { captureFaithful: enabled });
    await refresh();
  };

  const capture = async (
    type: 'capture/full' | 'capture/select',
  ): Promise<void> => {
    if (!selected) return;
    setBusy(true);
    setMessage({
      text:
        type === 'capture/full'
          ? 'Prepara y confirma la captura en la página.'
          : copy.selectionStarted,
      error: false,
    });
    const runtimeMessage: RuntimeMessage = {
      version: MESSAGE_PROTOCOL_VERSION,
      type,
      collectionId: selected.id,
      faithful: selected.captureFaithful,
    };
    try {
      const response: RuntimeResponse = await browser.runtime.sendMessage(
        runtimeMessage,
      );
      if (!response.ok) {
        throw new Error(response.error || 'No se pudo iniciar la captura.');
      }
      if (type === 'capture/full') {
        setMessage({ text: copy.saved, error: false });
      }
      await refresh();
    } catch (error) {
      setMessage({
        text:
          error instanceof Error
            ? error.message
            : 'No se pudo capturar la vista.',
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };

  const openManager = async (): Promise<void> => {
    await browser.tabs.create({ url: browser.runtime.getURL('/manager.html') });
    window.close();
  };

  return (
    <main className="popup">
      <header className="popup-header">
        <div className="logo" aria-hidden="true">
          P
        </div>
        <div>
          <h1>{copy.appName}</h1>
          <p>Capturas locales para lectura y archivo</p>
        </div>
      </header>

      <section className="card popup-card" aria-label="Captura actual">
        <label className="field">
          <span>Colección activa</span>
          <select
            value={selectedId}
            onChange={(event) => runAction(() => selectCollection(event.target.value))}
          >
            {collections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name} · {collection.itemCount}/50
              </option>
            ))}
          </select>
        </label>

        {selected ? (
          <div className="muted" aria-live="polite">
            {selected.itemCount} vistas · {formatBytes(selected.bytesUsed)}
          </div>
        ) : null}

        <div className="capture-grid">
          <button
            className="button primary"
            disabled={!selected || busy}
            onClick={() => void capture('capture/full')}
          >
            Añadir página completa
          </button>
          <button
            className="button"
            disabled={!selected || busy}
            onClick={() => void capture('capture/select')}
          >
            Seleccionar secciones
          </button>
        </div>

        <label className="faithful-toggle">
          <input
            type="checkbox"
            checked={selected?.captureFaithful ?? false}
            disabled={!selected || busy}
            onChange={(event) => runAction(() => toggleFaithful(event.target.checked))}
          />
          <span>
            <strong>Guardar también versión fiel</strong>
            <small>Solicita permiso avanzado solo al activarlo.</small>
          </span>
        </label>

        {message ? (
          <div
            className={message.error ? 'error' : 'success'}
            role={message.error ? 'alert' : 'status'}
          >
            {message.text}
          </div>
        ) : null}
      </section>

      <div className="popup-footer">
        <button className="button ghost" onClick={() => runAction(openManager)}>
          Abrir administrador
        </button>
      </div>

      <form
        className="new-collection popup-footer"
        onSubmit={(event) => {
          event.preventDefault();
          runAction(addCollection);
        }}
      >
        <label className="sr-only" htmlFor="new-collection-name">
          Nombre de colección
        </label>
        <input
          id="new-collection-name"
          className="text-input"
          value={newName}
          placeholder="Nueva colección"
          onChange={(event) => setNewName(event.target.value)}
        />
        <button className="button" type="submit">
          Crear
        </button>
      </form>
    </main>
  );
}
