import type { CapturePayload } from '../domain/types';

export const MESSAGE_PROTOCOL_VERSION = 2 as const;

export type RuntimeMessage =
  | {
      version: 2;
      type: 'capture/full';
      collectionId: string;
      faithful: boolean;
    }
  | {
      version: 2;
      type: 'capture/select';
      collectionId: string;
      faithful: boolean;
    }
  | {
      version: 2;
      type: 'capture/selection-ready';
      collectionId: string;
      faithful: boolean;
      payload: CapturePayload;
    }
  | {
      version: 2;
      type: 'content/full';
    }
  | {
      version: 2;
      type: 'content/select';
      collectionId: string;
      faithful: boolean;
    }
  | {
      version: 2;
      type: 'content/cleanup-print';
    };

export interface RuntimeResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!isRecord(value) || value.version !== MESSAGE_PROTOCOL_VERSION || typeof value.type !== 'string') {
    return false;
  }
  if (value.type === 'content/full' || value.type === 'content/cleanup-print') {
    return true;
  }
  if (value.type === 'capture/full' || value.type === 'capture/select') {
    return typeof value.collectionId === 'string' && typeof value.faithful === 'boolean';
  }
  if (value.type === 'content/select') {
    return typeof value.collectionId === 'string' && typeof value.faithful === 'boolean';
  }
  if (value.type === 'capture/selection-ready') {
    return typeof value.collectionId === 'string'
      && typeof value.faithful === 'boolean'
      && isRecord(value.payload);
  }
  return false;
}
