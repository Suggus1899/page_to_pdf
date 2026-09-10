import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

  test('abre popup y administrador usando el mismo paquete', async () => {
    let worker = context.serviceWorkers()[0];
    worker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;

    const popup = await context.newPage();
    const popupErrors: string[] = [];
    popup.on('pageerror', (error) => popupErrors.push(error.message));
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.getByRole('heading', { name: 'Colección Web PDF' })).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Capturar web completa' })).toBeEnabled();
    await expect(popup.locator('select')).toContainText('Mi primera colección');

    const manager = await context.newPage();
    const managerErrors: string[] = [];
    manager.on('pageerror', (error) => managerErrors.push(error.message));
    await manager.goto(`chrome-extension://${extensionId}/manager.html`);
    await expect(manager.getByRole('heading', { name: 'Colección Web PDF' })).toBeVisible();
    await expect(manager.getByRole('button', { name: 'Exportar PDF visual' })).toBeDisabled();
    await expect(manager.getByRole('button', { name: 'Exportar versión IA' })).toBeDisabled();
    await expect(manager.getByText('La colección está vacía')).toBeVisible();
    await manager.reload();
    await expect(manager.getByText('Mi primera colección')).toBeVisible();

    expect(popupErrors).toEqual([]);
    expect(managerErrors).toEqual([]);
  });
});
