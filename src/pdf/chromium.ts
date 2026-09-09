import type { PrintSettings } from '../domain/types';

const PROTOCOL_VERSION = '1.3';

interface PrintToPdfResult {
  data?: string;
}
function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function paperDimensions(paper: PrintSettings['paper']): { width: number; height: number } {
  return paper === 'a4'
    ? { width: 8.2677, height: 11.6929 }
    : { width: 8.5, height: 11 };
}

export async function hasDebuggerPermission(): Promise<boolean> {
  return chrome.permissions.contains({ permissions: ['debugger'] });
}

export async function captureTabAsPdf(
  tabId: number,
  settings: PrintSettings,
): Promise<ArrayBuffer> {
  if (!(await hasDebuggerPermission())) {
    throw new Error('El PDF visual necesita el permiso de captura avanzada.');
  }

  const target: chrome.debugger.Debuggee = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, PROTOCOL_VERSION);
    attached = true;
    await chrome.debugger.sendCommand(target, 'Page.enable');
    await chrome.debugger.sendCommand(target, 'Emulation.setEmulatedMedia', {
      media: 'screen',
    });
    const dimensions = paperDimensions(settings.paper);
    const result = (await chrome.debugger.sendCommand(target, 'Page.printToPDF', {
      landscape: settings.orientation === 'landscape',
      displayHeaderFooter: false,
      printBackground: settings.printBackground,
      scale: settings.scale,
      paperWidth: dimensions.width,
      paperHeight: dimensions.height,
      marginTop: settings.marginInches,
      marginBottom: settings.marginInches,
      marginLeft: settings.marginInches,
      marginRight: settings.marginInches,
      preferCSSPageSize: false,
      transferMode: 'ReturnAsBase64',
    })) as PrintToPdfResult;
    if (!result.data) throw new Error('El navegador no devolvió datos PDF.');
    return decodeBase64(result.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/another debugger|already attached|debugger is already/i.test(message)) {
      throw new Error('Cierra DevTools en esta pestaña y vuelve a intentar el PDF visual.');
    }
    throw new Error(`No se pudo crear el PDF visual: ${message}`);
  } finally {
    if (attached) {
      try {
        await chrome.debugger.sendCommand(target, 'Emulation.setEmulatedMedia', { media: '' });
      } catch {
        // The tab may have navigated or closed; detaching still runs below.
      }
      try {
        await chrome.debugger.detach(target);
      } catch {
        // The browser already detached if the target disappeared.
      }
    }
  }
}
