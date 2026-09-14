import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccountPanel } from '../../src/account/AccountPanel';
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
import { BrandMark } from '../../src/ui/BrandMark';
import {
  MESSAGE_PROTOCOL_VERSION,
  type RuntimeResponse,
} from '../../src/runtime/messages';
import { SemanticPreview } from './SemanticPreview';

interface PreviewState {
  title: string;
  kind: 'readable' | 'faithful';
  returnFocus: HTMLElement | null;
  document?: SemanticDocument;
  url?: string;
}

interface ProgressState {
  percent: number;
  label: string;
}

interface PreviewDialogProps {
  preview: PreviewState;
  returnFocus: HTMLElement | null;
  onClose: () => void;
}

function PreviewDialog({ preview, returnFocus, onClose }: PreviewDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog?.setAttribute('open', '');
    }
    return () => returnFocus?.focus();
  }, [returnFocus]);

  const close = (): void => {
    const dialog = dialogRef.current;
    if (dialog && typeof dialog.close === 'function') {
      dialog.close();
    } else {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="preview-dialog"
      aria-labelledby="preview-title"
      onCancel={onClose}
      onClose={onClose}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section className="preview-dialog-frame">
        <header>
          <div>
            <span className="eyebrow">Vista previa</span>
            <strong id="preview-title">{preview.title}</strong>
          </div>
          <span className="chip">{preview.kind === 'readable' ? 'Versión IA' : 'PDF visual'}</span>
          <button className="button" autoFocus onClick={close}>Cerrar</button>
        </header>
        <div className="preview-content">
          {preview.document ? <SemanticPreview document={preview.document} /> : null}
          {preview.url ? <iframe src={preview.url} title={'PDF visual de ' + preview.title} /> : null}
        </div>
      </section>
    </dialog>
  );
}

export function ManagerApp() {
  const [collections, setCollections] = useState<CollectionDraft[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [items, setItems] = useState<CaptureItem[]>([]);
  const [nameDraft, setNameDraft] = useState('');
  const [preview, setPreview] = useState<PreviewState>();
  const [progress, setProgress] = useState<ProgressState>();
  const [notice, setNotice] = useState<{ text: string; error: boolean }>();
  const [accountRefresh, setAccountRefresh] = useState(0);
  // Ref espejo para que `refresh` sea estable y no recree el efecto de carga
  // en cada selección (antes dependía de `selectedId` y re-disparaba fetches).
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

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
        : nextCollections.some((entry) => entry.id === selectedIdRef.current)
          ? selectedIdRef.current
          : nextCollections[0]!.id;
    const nextItems = await listCaptureItems(targetId);
    setCollections(nextCollections);
    setSelectedId(targetId);
    setItems(nextItems);
    setNameDraft(nextCollections.find((entry) => entry.id === targetId)?.name ?? '');
  }, []);

  useEffect(() => {
    runAction(refresh);
  }, [refresh, runAction]);

  useEffect(() => {
    let lastFocusRefresh = 0;
    const onFocus = (): void => {
      // Throttle: el foco puede dispararse en ráfagas (diálogos, descargas).
      const now = Date.now();
      if (now - lastFocusRefresh < 1500) return;
      lastFocusRefresh = now;
      runAction(() => refresh(selectedIdRef.current));
      setAccountRefresh((value) => value + 1);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh, runAction]);

  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  const selected = useMemo(
    () => collections.find((collection) => collection.id === selectedId),
    [collections, selectedId],
  );
  const { pendingCount, allFaithful, missingFaithful } = useMemo(() => {
    const pending = items.filter((item) => item.status === 'quota-pending').length;
    return {
      pendingCount: pending,
      allFaithful:
        items.length > 0 && pending === 0 && items.every((item) => item.faithfulAvailable),
      missingFaithful: items.filter((item) => !item.faithfulAvailable).length,
    };
  }, [items]);

  if (!selected) {
    return <main className="empty-state">Cargando colecciones…</main>;
  }

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
    const returnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const artifact = await getReadableArtifact(item.id);
    if (!artifact) throw new Error('No se encontró el contenido legible.');
    setPreview({ title: item.title, kind: 'readable', returnFocus, document: artifact.data });
  };

  const showFaithfulPreview = async (item: CaptureItem): Promise<void> => {
    const returnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const artifact = await getFaithfulArtifact(item.id);
    if (!artifact) throw new Error('Esta vista no tiene un PDF visual.');
    const url = URL.createObjectURL(new Blob([artifact.data], { type: 'application/pdf' }));
    setPreview({ title: item.title, kind: 'faithful', returnFocus, url });
  };

  const downloadPdf = async (
    profile: 'readable' | 'faithful',
  ): Promise<void> => {
    if (!selected || items.length === 0) return;
    if (items.some((item) => item.status !== 'ready')) {
      setNotice({ text: 'Recupera las capturas pendientes antes de exportar.', error: true });
      return;
    }
    setNotice(undefined);
    setProgress({ percent: 1, label: 'Preparando artefactos' });
    try {
      // Lotes de 5 lecturas IndexedDB en paralelo en vez de N round-trips en serie.
      const batched = async <T, R>(entries: T[], size: number, map: (entry: T) => Promise<R>): Promise<R[]> => {
        const output: R[] = [];
        for (let index = 0; index < entries.length; index += size) {
          output.push(...await Promise.all(entries.slice(index, index + size).map(map)));
        }
        return output;
      };
      let request: PdfWorkerRequest;
      if (profile === 'readable') {
        const exportItems = await batched(items, 5, async (item): Promise<ReadableExportItem> => {
          const artifact = await getReadableArtifact(item.id);
          if (!artifact) throw new Error('Falta la versión legible de "' + item.title + '".');
          return { item, document: artifact.data };
        });
        request = {
          id: crypto.randomUUID(),
          profile,
          collection: selected,
          items: exportItems,
        };
      } else {
        const exportItems = await batched(items, 5, async (item): Promise<FaithfulExportItem> => {
          const artifact = await getFaithfulArtifact(item.id);
          if (!artifact) {
            throw new Error('La vista "' + item.title + '" no tiene un PDF visual.');
          }
          return { item, pdf: artifact.data };
        });
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

  const reconcilePending = async (): Promise<void> => {
    const response: RuntimeResponse<{ recovered: number }> = await browser.runtime.sendMessage({
      version: MESSAGE_PROTOCOL_VERSION,
      type: 'quota/reconcile',
    });
    if (!response.ok) throw new Error(response.error || 'No se pudieron recuperar las capturas.');
    await refresh(selectedId);
    setAccountRefresh((value) => value + 1);
    setNotice({
      text: response.data?.recovered
        ? `${response.data.recovered} captura(s) recuperada(s).`
        : 'No había capturas pendientes por recuperar.',
      error: false,
    });
  };

  if (!selected) {
    return <main className="empty-state">Cargando colecciones…</main>;
  }

  return (
    <main className="manager-shell">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <div>
            <h1>Colección Web PDF</h1>
            <span>Archivo multivista</span>
          </div>
        </div>
        <div className="sidebar-heading">
          <strong>Colecciones</strong>
          <span>{collections.length}</span>
        </div>
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
            <span aria-hidden="true">＋</span> Nueva colección
          </button>
          <button className="button ghost" onClick={() => runAction(() => refresh(selectedId))}>
            Actualizar
          </button>
        </div>
        <div className="sidebar-danger">
          <button className="button danger-ghost" onClick={() => runAction(eraseEverything)}>
            Borrar todos los datos
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div className="workspace-heading">
            <span className="eyebrow">Colección activa</span>
            <label className="sr-only" htmlFor="collection-title">Nombre de colección</label>
            <input
              id="collection-title"
              className="workspace-title"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={() => runAction(saveCollectionName)}
            />
            <div className="collection-summary muted">
              <span>{selected.itemCount} {selected.itemCount === 1 ? 'vista' : 'vistas'}</span>
              <span>{formatBytes(selected.bytesUsed)} de 300 MB</span>
            </div>
          </div>
          <div className="header-actions">
            <button
              className="button primary"
              disabled={!allFaithful || Boolean(progress)}
              title={allFaithful ? '' : 'Todas las vistas deben tener una captura visual'}
              onClick={() => void downloadPdf('faithful')}
            >
              Exportar PDF visual
            </button>
            <button
              className="button"
              disabled={items.length === 0 || pendingCount > 0 || Boolean(progress)}
              onClick={() => void downloadPdf('readable')}
            >
              Exportar versión IA
            </button>
            <button className="button danger-ghost" onClick={() => runAction(removeSelectedCollection)}>
              Eliminar colección
            </button>
          </div>
        </header>

        <AccountPanel refreshToken={accountRefresh} />

        <section className="card settings" aria-label="Configuración de impresión">
          <div className="settings-heading">
            <span className="settings-icon" aria-hidden="true">Aa</span>
            <div>
              <h2>Ajustes del PDF visual</h2>
              <p>Formato aplicado a esta colección</p>
            </div>
          </div>
          <div className="settings-fields">
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
              <span>Escala visual</span>
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
              <span><strong>Imprimir fondos</strong><small>Incluye colores e imágenes.</small></span>
            </label>
          </div>
        </section>

        {missingFaithful > 0 ? (
          <div className="warning" role="status">
            {missingFaithful} {missingFaithful === 1 ? 'vista fue guardada' : 'vistas fueron guardadas'} solo como texto.
            Elimina {missingFaithful === 1 ? 'esa vista' : 'esas vistas'} y vuelve a capturar para obtener el PDF visual completo.
          </div>
        ) : null}

        {pendingCount > 0 ? (
          <div className="warning pending-warning" role="status">
            <span>{pendingCount} {pendingCount === 1 ? 'captura está pendiente' : 'capturas están pendientes'} de validar y no se pueden exportar.</span>
            <button className="button" onClick={() => runAction(reconcilePending)}>Recuperar ahora</button>
          </div>
        ) : null}

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
            <span className="empty-icon" aria-hidden="true">＋</span>
            <h2>La colección está vacía</h2>
            <p className="muted">Abre la extensión sobre una web para capturarla completa o seleccionar secciones.</p>
          </section>
        ) : (
          <div className="captures">
            <header className="list-header">
              <div>
                <span className="eyebrow">Contenido</span>
                <h2>Vistas capturadas</h2>
              </div>
              <span className="list-count">{items.length} {items.length === 1 ? 'vista' : 'vistas'}</span>
            </header>
            <section className="item-list" aria-label="Vistas capturadas">
              {items.map((item, index) => (
                <article className="card capture-item" key={item.id}>
                  <div className="item-order">
                    <span className="order-number">{String(index + 1).padStart(2, '0')}</span>
                    <div className="order-actions">
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
                    <a className="item-url" href={item.url} target="_blank" rel="noreferrer">
                      {item.url}<span aria-hidden="true"> ↗</span>
                    </a>
                    <div className="item-details">
                      <div className="chips">
                        <span className="chip">{item.scope.kind === 'full-page' ? 'Página completa' : 'Secciones'}</span>
                        <span className="chip good">
                          {item.faithfulAvailable ? 'Versión IA' : 'Solo versión IA'}
                        </span>
                        {item.faithfulAvailable ? <span className="chip visual">PDF visual</span> : null}
                        {item.status === 'quota-pending' ? <span className="chip pending">Validación pendiente</span> : null}
                      </div>
                      <div className="item-meta muted">
                        <span>{formatBytes(item.bytesUsed)}</span>
                        <span>{new Date(item.capturedAt).toLocaleString('es-VE')}</span>
                      </div>
                    </div>
                  </div>
                  <div className="item-actions">
                    <button className="button ghost" onClick={() => runAction(() => showReadablePreview(item))}>
                      Ver texto
                    </button>
                    <button
                      className="button ghost"
                      disabled={!item.faithfulAvailable || item.status !== 'ready'}
                      onClick={() => runAction(() => showFaithfulPreview(item))}
                    >
                      Ver PDF visual
                    </button>
                    <button className="button danger-ghost" onClick={() => runAction(() => removeItem(item))}>
                      Eliminar
                    </button>
                  </div>
                </article>
              ))}
            </section>
          </div>
        )}
      </section>

      {preview ? (
        <PreviewDialog
          preview={preview}
          returnFocus={preview.returnFocus}
          onClose={() => setPreview(undefined)}
        />
      ) : null}
    </main>
  );
}
