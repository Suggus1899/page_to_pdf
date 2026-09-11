import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: () => {
    const supabaseUrl = import.meta.env.WXT_SUPABASE_URL?.trim();
    const hostPermissions = supabaseUrl ? [`${new URL(supabaseUrl).origin}/*`] : [];
    return {
      name: '__MSG_extensionName__',
      description: '__MSG_extensionDescription__',
      default_locale: 'es',
      permissions: [
        'activeTab',
        'scripting',
        'storage',
        'downloads',
        'unlimitedStorage',
        'debugger',
      ],
      host_permissions: hostPermissions,
      icons: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
        48: 'icons/icon-48.png',
        128: 'icons/icon-128.png',
      },
      action: {
        default_title: '__MSG_extensionName__',
        default_icon: {
          16: 'icons/icon-16.png',
          32: 'icons/icon-32.png',
          48: 'icons/icon-48.png',
          128: 'icons/icon-128.png',
        },
      },
    };
  },
});
