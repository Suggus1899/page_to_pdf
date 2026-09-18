import { describe, expect, it } from 'vitest';
import { isRuntimeMessage, MESSAGE_PROTOCOL_VERSION } from '../src/runtime/messages';

describe('protocolo interno', () => {
  it('acepta mensajes con la versión actual', () => {
    expect(
      isRuntimeMessage({
        version: MESSAGE_PROTOCOL_VERSION,
        type: 'content/full',
      }),
    ).toBe(true);
  });

  it('rechaza versiones y estructuras desconocidas', () => {
    expect(isRuntimeMessage({ version: 3, type: 'content/full' })).toBe(false);
    expect(isRuntimeMessage(null)).toBe(false);
    expect(isRuntimeMessage({ version: 2 })).toBe(false);
    expect(isRuntimeMessage({ version: 2, type: 'unknown/action' })).toBe(false);
  });
});
