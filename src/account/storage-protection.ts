// Sin dependencias pesadas a propósito: este módulo lo carga el background al
// arrancar (onInstalled/onStartup). No debe importar supabase-js para no
// inflar el chunk inicial del service worker.
export async function protectAccountStorage(): Promise<void> {
  const storage = browser.storage.local as unknown as {
    setAccessLevel?: (options: { accessLevel: 'TRUSTED_CONTEXTS' }) => Promise<void>;
  };
  await storage.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
}
