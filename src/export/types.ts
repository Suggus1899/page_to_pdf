import type {
  CaptureItem,
  CollectionDraft,
  SemanticDocument,
} from '../domain/types';

export interface ReadableExportItem {
  item: CaptureItem;
  document: SemanticDocument;
}

export interface FaithfulExportItem {
  item: CaptureItem;
  pdf: ArrayBuffer;
}

export type PdfWorkerRequest =
  | {
      id: string;
      profile: 'readable';
      collection: CollectionDraft;
      items: ReadableExportItem[];
    }
  | {
      id: string;
      profile: 'faithful';
      collection: CollectionDraft;
      items: FaithfulExportItem[];
    };

export type PdfWorkerResponse =
  | { id: string; type: 'progress'; percent: number; label: string }
  | { id: string; type: 'complete'; pdf: ArrayBuffer }
  | { id: string; type: 'error'; error: string };
