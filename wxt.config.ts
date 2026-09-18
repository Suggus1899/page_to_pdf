import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    build: {
      // Menos I/O y zips más pequeños: sin sourcemaps en el artefacto final.
      sourcemap: false,
      reportCompressedSize: false,
      chunkSizeWarningLimit: 600,
    },
  }),
  manifest: {
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
  },
});
