import type { CapturePayload } from '../domain/types';

export const MESSAGE_PROTOCOL_VERSION = 1 as const;

export type RuntimeMessage =
  | {
      version: 1;
      type: 'capture/full';
      collectionId: string;
      faithful: boolean;
    }
  | {
      version: 1;
      type: 'capture/select';
      collectionId: string;
      faithful: boolean;
    }
  | {
      version: 1;
      type: 'capture/selection-ready';
      collectionId: string;
      faithful: boolean;
      payload: CapturePayload;
    }
  | {
      version: 1;
      type: 'content/full';
    }
  | {
      version: 1;
      type: 'content/select';
      collectionId: string;
      faithful: boolean;
    }
  | {
      version: 1;
      type: 'content/cleanup-print';
    };

export interface RuntimeResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<RuntimeMessage>;
  return message.version === MESSAGE_PROTOCOL_VERSION && typeof message.type === 'string';
}
