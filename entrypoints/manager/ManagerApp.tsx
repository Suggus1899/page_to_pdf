import { useCallback, useEffect, useState } from 'react';
import type {
  CaptureItem,
  CollectionDraft,
  SemanticDocument,
} from '../../src/domain/types';
import { createPdfInWorker } from '../../src/export/worker-client';
import type {
  FaithfulExportItem,
  PdfWorkerRequest,
  ReadableExportItem,
} from '../../src/export/types';
import {
  clearAllData,
  createCollection,
  deleteCaptureItem,
  deleteCollection,
  ensureDefaultCollection,
  getFaithfulArtifact,
  getReadableArtifact,
  listCaptureItems,
  listCollections,
  renameCaptureItem,
  reorderCaptureItems,
  updateCollection,
} from '../../src/storage/database';
import { buildPdfFilename, formatBytes } from '../../src/utils/filename';
import { SemanticPreview } from './SemanticPreview';

interface PreviewState {
  title: string;
  kind: 'readable' | 'faithful';
  document?: SemanticDocument;
  url?: string;
}

interface ProgressState {
  percent: number;
  label: string;
}

export function ManagerApp() {
  const [collections, setCollections] = useState<CollectionDraft[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [items, setItems] = useState<CaptureItem[]>([]);
  const [nameDraft, setNameDraft] = useState('');
  const [preview, setPreview] = useState<PreviewState>();
  const [progress, setProgress] = useState<ProgressState>();
  const [notice, setNotice] = useState<{ text: string; error: boolean }>();

  const reportError = useCallback((error: unknown): void => {
    setNotice({
      text: error instanceof Error ? error.message : 'No se pudo completar la acción.',
      error: true,
    });
  }, []);

  const runAction = useCallback((action: () => Promise<void>): void => {
    void action().catch(reportError);
  }, [reportError]);

  const refresh = useCallback(async (preferredId?: string) => {
    let nextCollections = await listCollections();
    if (nextCollections.length === 0) {
      nextCollections = [await ensureDefaultCollection()];
    }
    const targetId =
      preferredId && nextCollections.some((entry) => entry.id === preferredId)
        ? preferredId
        : selectedId && nextCollections.some((entry) => entry.id === selectedId)
          ? selectedId
          : nextCollections[0]!.id;
    const nextItems = await listCaptureItems(targetId);
    setCollections(nextCollections);
    setSelectedId(targetId);
    setItems(nextItems);
    setNameDraft(nextCollections.find((entry) => entry.id === targetId)?.name ?? '');
  }, [selectedId]);

  useEffect(() => {
    runAction(refresh);
  }, [refresh, runAction]);

  useEffect(() => {
    const onFocus = (): void => {
      runAction(() => refresh(selectedId));
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh, runAction, selectedId]);

  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  const selected = collections.find((collection) => collection.id === selectedId);

  const selectCollection = async (id: string): Promise<void> => {
    setSelectedId(id);
    await refresh(id);
  };

  const addCollection = async (): Promise<void> => {
    const name = window.prompt('Nombre de la nueva colección', 'Nueva colección');
    if (name === null) return;
    const created = await createCollection(name);
    await refresh(created.id);
  };

  const saveCollectionName = async (): Promise<void> => {
    if (!selected || nameDraft.trim() === selected.name) return;
    await updateCollection(selected.id, { name: nameDraft });
    await refresh(selected.id);
  };

  const updateSettings = async (
    patch: Parameters<typeof updateCollection>[1],
  ): Promise<void> => {
    if (!selected) return;
    await updateCollection(selected.id, patch);
    await refresh(selected.id);
  };

  const moveItem = async (index: number, direction: -1 | 1): Promise<void> => {
    if (!selected) return;
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const currentItem = next[index]!;
    next[index] = next[target]!;
    next[target] = currentItem;
    setItems(next);
    await reorderCaptureItems(selected.id, next.map((item) => item.id));
    await refresh(selected.id);
  };

  const removeItem = async (item: CaptureItem): Promise<void> => {
    if (!window.confirm('¿Eliminar la vista "' + item.title + '"?')) return;
    await deleteCaptureItem(item.id);
    await refresh(selectedId);
  };

  const showReadablePreview = async (item: CaptureItem): Promise<void> => {
    const artifact = await getReadableArtifact(item.id);
    if (!artifact) throw new Error('No se encontró el contenido legible.');
    setPreview({ title: item.title, kind: 'readable', document: artifact.data });
  };

  const showFaithfulPreview = async (item: CaptureItem): Promise<void> => {
    const artifact = await getFaithfulArtifact(item.id);
    if (!artifact) throw new Error('Esta vista no tiene una captura fiel.');
    const url = URL.createObjectURL(new Blob([artifact.data], { type: 'application/pdf' }));
    setPreview({ title: item.title, kind: 'faithful', url });
  };

  const downloadPdf = async (
    profile: 'readable' | 'faithful',
  ): Promise<void> => {
    if (!selected || items.length === 0) return;
    setNotice(undefined);
    setProgress({ percent: 1, label: 'Preparando artefactos' });
    try {
      let request: PdfWorkerRequest;
      if (profile === 'readable') {
        const exportItems: ReadableExportItem[] = [];
        for (const item of items) {
          const artifact = await getReadableArtifact(item.id);
          if (!artifact) throw new Error('Falta la versión legible de "' + item.title + '".');
          exportItems.push({ item, document: artifact.data });
        }
        request = {
          id: crypto.randomUUID(),
          profile,
          collection: selected,
          items: exportItems,
        };
      } else {
        const exportItems: FaithfulExportItem[] = [];
        for (const item of items) {
          const artifact = await getFaithfulArtifact(item.id);
          if (!artifact) {
            throw new Error('La vista "' + item.title + '" no tiene una captura fiel.');
          }
          exportItems.push({ item, pdf: artifact.data });
        }
        request = {
          id: crypto.randomUUID(),
          profile,
          collection: selected,
          items: exportItems,
        };
      }

      const pdf = await createPdfInWorker(request, (percent, label) => {
        setProgress({ percent, label });
      });
      const objectUrl = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
      await browser.downloads.download({
        url: objectUrl,
        filename: buildPdfFilename(selected.name),
        saveAs: true,
      });
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      setNotice({ text: 'PDF generado y enviado a Descargas.', error: false });
    } catch (error) {
      setNotice({
        text: error instanceof Error ? error.message : 'No se pudo exportar el PDF.',
        error: true,
      });
    } finally {
      setProgress(undefined);
    }
  };

  const removeSelectedCollection = async (): Promise<void> => {
    if (!selected || !window.confirm('¿Eliminar esta colección y todos sus artefactos?')) return;
    await deleteCollection(selected.id);
    await refresh();
  };

  const eraseEverything = async (): Promise<void> => {
    if (!window.confirm('¿Borrar todas las colecciones y capturas locales? Esta acción no se puede deshacer.')) return;
    await clearAllData();
    await refresh();
  };

  if (!selected) {
    return <main className="empty-state">Cargando colecciones…</main>;
  }

  const allFaithful = items.length > 0 && items.every((item) => item.faithfulAvailable);

  return (
    <main className="manager-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo" aria-hidden="true">P</div>
          <h1>Colección Web PDF</h1>
        </div>
        <strong>Colecciones</strong>
        <nav className="collection-list" aria-label="Colecciones guardadas">
          {collections.map((collection) => (
            <button
              key={collection.id}
              className={'collection-button ' + (collection.id === selectedId ? 'active' : '')}
              onClick={() => runAction(() => selectCollection(collection.id))}
            >
              <strong>{collection.name}</strong>
              <span>{collection.itemCount} vistas · {formatBytes(collection.bytesUsed)}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-actions">
          <button className="button primary" onClick={() => runAction(addCollection)}>
            Nueva colección
          </button>
          <button className="button ghost" onClick={() => runAction(() => refresh(selectedId))}>
            Actualizar
          </button>
          <button className="button danger" onClick={() => runAction(eraseEverything)}>
            Borrar todos los datos
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <label className="sr-only" htmlFor="collection-title">Nombre de colección</label>
            <input
              id="collection-title"
              className="workspace-title"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={() => runAction(saveCollectionName)}
            />
            <p className="muted">
              {selected.itemCount}/50 vistas · {formatBytes(selected.bytesUsed)} de 250 MB
            </p>
          </div>
          <div className="header-actions">
            <button
              className="button primary"
              disabled={items.length === 0 || Boolean(progress)}
              onClick={() => void downloadPdf('readable')}
            >
              Exportar Lectura IA
            </button>
            <button
              className="button"
              disabled={!allFaithful || Boolean(progress)}
              title={allFaithful ? '' : 'Todas las vistas deben tener versión fiel'}
              onClick={() => void downloadPdf('faithful')}
            >
              Exportar Fiel
            </button>
            <button className="button danger" onClick={() => runAction(removeSelectedCollection)}>
              Eliminar colección
            </button>
          </div>
        </header>

        <section className="card settings" aria-label="Configuración de impresión">
          <label className="field">
            <span>Papel</span>
            <select
              value={selected.printSettings.paper}
              onChange={(event) => runAction(() => updateSettings({
                printSettings: { paper: event.target.value as 'letter' | 'a4' },
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
              onChange={(event) => runAction(() => updateSettings({
                printSettings: {
                  orientation: event.target.value as 'portrait' | 'landscape',
                },
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
              onChange={(event) => runAction(() => updateSettings({
                printSettings: { marginInches: Number(event.target.value) },
              }))}
            >
              <option value="0.25">Estrecho</option>
              <option value="0.5">Normal</option>
              <option value="0.75">Amplio</option>
            </select>
          </label>
          <label className="field">
            <span>Escala fiel</span>
            <select
              value={selected.printSettings.scale}
              onChange={(event) => runAction(() => updateSettings({
                printSettings: { scale: Number(event.target.value) },
              }))}
            >
              <option value="0.75">75%</option>
              <option value="0.9">90%</option>
              <option value="1">100%</option>
              <option value="1.1">110%</option>
              <option value="1.25">125%</option>
            </select>
          </label>
          <label className="faithful-toggle">
            <input
              type="checkbox"
              checked={selected.printSettings.printBackground}
              onChange={(event) => runAction(() => updateSettings({
                printSettings: { printBackground: event.target.checked },
              }))}
            />
            <span><strong>Imprimir fondos</strong><small>Aplica al modo fiel.</small></span>
          </label>
        </section>

        {progress ? (
          <section className="card progress-card" aria-live="polite">
            <strong>{progress.label}</strong>
            <progress value={progress.percent} max="100">{progress.percent}%</progress>
          </section>
        ) : null}
        {notice ? (
          <div className={notice.error ? 'error' : 'success'} role={notice.error ? 'alert' : 'status'}>
            {notice.text}
          </div>
        ) : null}

        {items.length === 0 ? (
          <section className="card empty-state">
            <h2>La colección está vacía</h2>
            <p className="muted">Abre el popup sobre una web para añadir la página o seleccionar secciones.</p>
          </section>
        ) : (
          <section className="item-list" aria-label="Vistas capturadas">
            {items.map((item, index) => (
              <article className="card capture-item" key={item.id}>
                <div className="item-order">
                  <button
                    aria-label={'Subir ' + item.title}
                    disabled={index === 0}
                    onClick={() => runAction(() => moveItem(index, -1))}
                  >
                    ↑
                  </button>
                  <button
                    aria-label={'Bajar ' + item.title}
                    disabled={index === items.length - 1}
                    onClick={() => runAction(() => moveItem(index, 1))}
                  >
                    ↓
                  </button>
                </div>
                <div className="item-main">
                  <label className="sr-only" htmlFor={'title-' + item.id}>Título de la vista</label>
                  <input
                    id={'title-' + item.id}
                    className="item-title"
                    value={item.title}
                    onChange={(event) => {
                      const value = event.target.value;
                      setItems((current) =>
                        current.map((entry) =>
                          entry.id === item.id ? { ...entry, title: value } : entry,
                        ),
                      );
                    }}
                    onBlur={(event) => runAction(() => renameCaptureItem(item.id, event.target.value))}
                  />
                  <a className="item-url" href={item.url} target="_blank" rel="noreferrer">{item.url}</a>
                  <div className="chips">
                    <span className="chip">{item.scope.kind === 'full-page' ? 'Página completa' : 'Secciones'}</span>
                    <span className="chip good">Lectura IA</span>
                    {item.faithfulAvailable ? <span className="chip good">Fiel</span> : null}
                    <span className="chip">{formatBytes(item.bytesUsed)}</span>
                    <span className="chip">{new Date(item.capturedAt).toLocaleString('es-VE')}</span>
                  </div>
                </div>
                <div className="item-actions">
                  <button className="button ghost" onClick={() => runAction(() => showReadablePreview(item))}>
                    Ver texto
                  </button>
                  <button
                    className="button ghost"
                    disabled={!item.faithfulAvailable}
                    onClick={() => runAction(() => showFaithfulPreview(item))}
                  >
                    Ver PDF
                  </button>
                  <button className="button danger" onClick={() => runAction(() => removeItem(item))}>
                    Eliminar
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}
      </section>

      {preview ? (
        <div
          className="preview-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreview(undefined);
          }}
        >
          <section className="card preview-dialog" role="dialog" aria-modal="true" aria-label={'Vista previa de ' + preview.title}>
            <header>
              <strong>{preview.title}</strong>
              <span className="chip">{preview.kind === 'readable' ? 'Lectura IA' : 'Fiel'}</span>
              <button className="button" autoFocus onClick={() => setPreview(undefined)}>Cerrar</button>
            </header>
            <div className="preview-content">
              {preview.document ? <SemanticPreview document={preview.document} /> : null}
              {preview.url ? <iframe src={preview.url} title={'PDF fiel de ' + preview.title} /> : null}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
