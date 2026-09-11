export type CaptureKind = 'readable' | 'faithful';

export type CaptureScope =
  | { kind: 'full-page' }
  | {
      kind: 'selection';
      included: string[];
      excluded: string[];
    };

export interface PrintSettings {
  paper: 'letter' | 'a4';
  orientation: 'portrait' | 'landscape';
  marginInches: number;
  scale: number;
  printBackground: boolean;
}

export interface CollectionDraft {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  bytesUsed: number;
  status: 'ready';
  captureFaithful: boolean;
  printSettings: PrintSettings;
}

export interface CaptureItem {
  id: string;
  collectionId: string;
  position: number;
  title: string;
  url: string;
  capturedAt: string;
  viewport: { width: number; height: number; devicePixelRatio: number };
  scope: CaptureScope;
  status: 'ready' | 'quota-pending';
  quotaReservationId?: string;
  readableAvailable: boolean;
  faithfulAvailable: boolean;
  bytesUsed: number;
  warnings: string[];
}

export interface SemanticLink {
  label: string;
  url: string;
}

export type SemanticBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string; links: SemanticLink[] }
  | { type: 'paragraph'; text: string; links: SemanticLink[] }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; rows: string[][]; headerRows: number }
  | { type: 'code'; text: string; language?: string }
  | { type: 'quote'; text: string }
  | { type: 'figure'; alt: string; caption?: string; sourceUrl?: string; dataUrl?: string }
  | { type: 'link'; label: string; url: string }
  | { type: 'section-break' };

export interface SemanticDocument {
  schemaVersion: 1;
  title: string;
  url: string;
  capturedAt: string;
  language: string;
  blocks: SemanticBlock[];
}

export interface CapturePayload {
  title: string;
  url: string;
  capturedAt: string;
  viewport: CaptureItem['viewport'];
  scope: CaptureScope;
  document: SemanticDocument;
  warnings: string[];
}

export interface CaptureArtifact<T = SemanticDocument | ArrayBuffer> {
  id: string;
  itemId: string;
  collectionId: string;
  kind: CaptureKind;
  bytes: number;
  data: T;
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  paper: 'letter',
  orientation: 'portrait',
  marginInches: 0.5,
  scale: 1,
  printBackground: true,
};
