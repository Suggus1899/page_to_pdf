import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';

const executablePath = process.env.BROWSER_EXECUTABLE;
const installedBrowserPath = executablePath ?? chromium.executablePath();
const extensionPath = path.resolve('.output/chrome-mv3');

test.describe('build Chromium sin empaquetar', () => {
  let context: BrowserContext;
  let profileDirectory: string;

  test.beforeAll(async () => {
    profileDirectory = mkdtempSync(path.join(tmpdir(), 'collection-web-pdf-e2e-'));
    context = await chromium.launchPersistentContext(profileDirectory, {
      executablePath: installedBrowserPath,
      headless: false,
      args: [
        '--no-first-run',
        '--disable-default-apps',
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
  });

  test.afterAll(async () => {
    await context?.close();
    if (profileDirectory?.startsWith(tmpdir())) {
      rmSync(profileDirectory, { recursive: true, force: true });
    }
  });

  test('declara debugger como permiso requerido', () => {
    const parsed: unknown = JSON.parse(
      readFileSync(path.join(extensionPath, 'manifest.json'), 'utf8'),
    );
    if (!parsed || typeof parsed !== 'object') throw new Error('El manifiesto generado no es válido.');
    const manifest = parsed as Record<string, unknown>;

    expect(manifest.permissions).toContain('debugger');
    expect(manifest.optional_permissions).toBeUndefined();
  });

  test('incluye la identidad visual en el manifiesto', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(extensionPath, 'manifest.json'), 'utf8'),
    ) as { icons?: Record<string, string>; action?: { default_icon?: Record<string, string> } };

    for (const size of ['16', '32', '48', '128']) {
      expect(manifest.icons?.[size]).toBe(`icons/icon-${size}.png`);
      expect(manifest.action?.default_icon?.[size]).toBe(`icons/icon-${size}.png`);
      expect(existsSync(path.join(extensionPath, `icons/icon-${size}.png`))).toBe(true);
    }
  });

  test('abre popup y administrador usando el mismo paquete', async () => {
    let worker = context.serviceWorkers()[0];
    worker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;

    const popup = await context.newPage();
    const popupErrors: string[] = [];
    popup.on('pageerror', (error) => popupErrors.push(error.message));
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator('img.brand-mark')).toBeVisible();
    await expect(popup.getByRole('heading', { name: 'Colección Web PDF' })).toBeVisible();
    await expect(popup.getByText('Cuenta pendiente de configuración')).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Capturar web completa' })).toBeDisabled();
    await expect(popup.getByRole('combobox', { name: 'Colección activa' })).toContainText(
      'Mi primera colección',
    );

    const manager = await context.newPage();
    const managerErrors: string[] = [];
    manager.on('pageerror', (error) => managerErrors.push(error.message));
    await manager.goto(`chrome-extension://${extensionId}/manager.html`);
    await expect(manager.locator('img.brand-mark')).toBeVisible();
    await expect(manager.getByRole('heading', { name: 'Colección Web PDF' })).toBeVisible();
    await expect(manager.getByRole('button', { name: 'Exportar PDF visual' })).toBeDisabled();
    await expect(manager.getByRole('button', { name: 'Exportar versión IA' })).toBeDisabled();
    await expect(manager.getByText('La colección está vacía')).toBeVisible();
    await manager.reload();
    await expect(manager.getByText('Mi primera colección')).toBeVisible();

    for (const viewport of [
      { width: 1366, height: 768 },
      { width: 1024, height: 768 },
      { width: 720, height: 800 },
    ]) {
      await manager.setViewportSize(viewport);
      expect(await manager.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }

    expect(popupErrors).toEqual([]);
    expect(managerErrors).toEqual([]);
  });
});
