import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
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
    action: {
      default_title: '__MSG_extensionName__',
    },
  },
});
