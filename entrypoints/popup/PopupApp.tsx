import { useCallback, useEffect, useState } from 'react';
import type { CollectionDraft } from '../../src/domain/types';
import { MAX_COLLECTION_BYTES } from '../../src/domain/limits';
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
import { BrandMark } from '../../src/ui/BrandMark';

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

  const enableVisualCapture = async (): Promise<void> => {
    if (!selected) return;
    if (!selected.captureFaithful) {
      await updateCollection(selected.id, { captureFaithful: true });
    }
  };

  const updatePrintSettings = async (
    printSettings: Partial<CollectionDraft['printSettings']>,
  ): Promise<void> => {
    if (!selected) return;
    await updateCollection(selected.id, { printSettings });
    await refresh();
  };

  const capture = async (
    type: 'capture/full' | 'capture/select',
  ): Promise<void> => {
    if (!selected) return;
    setBusy(true);
    try {
      await enableVisualCapture();
      setMessage({
        text:
          type === 'capture/full'
            ? 'Prepara y confirma la captura visual en la página.'
            : copy.selectionStarted,
        error: false,
      });
      const runtimeMessage: RuntimeMessage = {
        version: MESSAGE_PROTOCOL_VERSION,
        type,
        collectionId: selected.id,
        faithful: true,
      };
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
        <BrandMark />
        <div>
          <h1>{copy.appName}</h1>
          <p>Captura local · PDF visual e IA</p>
        </div>
      </header>

      <section className="card popup-card" aria-label="Captura actual">
        <div className="collection-block">
          <label className="field">
            <span>Colección activa</span>
            <select
              value={selectedId}
              onChange={(event) => runAction(() => selectCollection(event.target.value))}
            >
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name} · {collection.itemCount} {collection.itemCount === 1 ? 'vista' : 'vistas'}
                </option>
              ))}
            </select>
          </label>

          {selected ? (
            <div className="collection-usage muted" aria-live="polite">
              <span>{selected.itemCount} {selected.itemCount === 1 ? 'vista' : 'vistas'}</span>
              <span>{formatBytes(selected.bytesUsed)} de 300 MB</span>
              <span className="usage-track" aria-hidden="true">
                <span style={{ width: `${Math.min(100, selected.bytesUsed / MAX_COLLECTION_BYTES * 100)}%` }} />
              </span>
            </div>
          ) : null}
        </div>

        <div className="capture-grid">
          <button
            className="button primary"
            aria-label="Capturar web completa"
            disabled={!selected || busy}
            onClick={() => void capture('capture/full')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 3h7l4 4v14H7zM14 3v5h4M4 7v10" />
            </svg>
            <span><strong>Web completa</strong><small>Toda la página actual</small></span>
          </button>
          <button
            className="button"
            aria-label="Capturar secciones"
            disabled={!selected || busy}
            onClick={() => void capture('capture/select')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M8 8h8v8H8z" />
            </svg>
            <span><strong>Secciones</strong><small>Elige áreas concretas</small></span>
          </button>
        </div>

        {selected ? (
          <details className="quick-settings">
            <summary>
              <span className="summary-icon" aria-hidden="true">Aa</span>
              <span>
                <strong>Opciones del PDF</strong>
                <small>
                  {selected.printSettings.paper === 'letter' ? 'Carta' : 'A4'} ·{' '}
                  {selected.printSettings.orientation === 'portrait' ? 'Vertical' : 'Horizontal'} ·{' '}
                  {Math.round(selected.printSettings.scale * 100)}%
                </small>
              </span>
              <span className="chevron" aria-hidden="true">⌄</span>
            </summary>
            <div className="quick-settings-grid">
              <label className="field">
                <span>Papel</span>
                <select
                  value={selected.printSettings.paper}
                  onChange={(event) => runAction(() => updatePrintSettings({
                    paper: event.target.value as 'letter' | 'a4',
                  }))}
                >
                  <option value="letter">Carta</option>
                  <option value="a4">A4</option>
                </select>
              </label>
              <label className="field">
                <span>Orientación</span>
                <select
                  value={selected.printSettings.orientation}
                  onChange={(event) => runAction(() => updatePrintSettings({
                    orientation: event.target.value as 'portrait' | 'landscape',
                  }))}
                >
                  <option value="portrait">Vertical</option>
                  <option value="landscape">Horizontal</option>
                </select>
              </label>
              <label className="field">
                <span>Margen</span>
                <select
                  value={selected.printSettings.marginInches}
                  onChange={(event) => runAction(() => updatePrintSettings({
                    marginInches: Number(event.target.value),
                  }))}
                >
                  <option value="0.25">Estrecho</option>
                  <option value="0.5">Normal</option>
                  <option value="0.75">Amplio</option>
                </select>
              </label>
              <label className="field">
                <span>Escala</span>
                <select
                  value={selected.printSettings.scale}
                  onChange={(event) => runAction(() => updatePrintSettings({
                    scale: Number(event.target.value),
                  }))}
                >
                  <option value="0.75">75%</option>
                  <option value="0.9">90%</option>
                  <option value="1">100%</option>
                  <option value="1.1">110%</option>
                  <option value="1.25">125%</option>
                </select>
              </label>
              <label className="background-option">
                <input
                  type="checkbox"
                  checked={selected.printSettings.printBackground}
                  onChange={(event) => runAction(() => updatePrintSettings({
                    printBackground: event.target.checked,
                  }))}
                />
                <span><strong>Imprimir fondos</strong><small>Conserva colores e imágenes.</small></span>
              </label>
            </div>
          </details>
        ) : null}

        <p className="privacy-note">
          <span aria-hidden="true">◆</span>
          Captura visual local con el permiso avanzado aceptado al cargar la extensión. Ningún contenido sale de tu dispositivo.
        </p>

        {message ? (
          <div
            className={message.error ? 'error' : 'success'}
            role={message.error ? 'alert' : 'status'}
          >
            {message.text}
          </div>
        ) : null}
      </section>

      <div className="popup-footer manager-link">
        <button className="button ghost" onClick={() => runAction(openManager)}>
          Abrir administrador <span aria-hidden="true">↗</span>
        </button>
      </div>

      <details className="new-collection-panel">
        <summary>＋ Crear una colección</summary>
        <form
          className="new-collection"
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
            placeholder="Nombre de la colección"
            onChange={(event) => setNewName(event.target.value)}
          />
          <button className="button" type="submit">
            Crear
          </button>
        </form>
      </details>
    </main>
  );
}
