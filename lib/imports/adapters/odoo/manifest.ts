import type { ImporterManifest } from '@/lib/imports/types';

export const manifest: ImporterManifest = {
  id: 'odoo',
  displayName: 'Odoo',
  icon: 'cube',
  authType: 'api_key',
  capabilities: {
    supportsComments: true,
    supportsAttachments: true,
    supportsHierarchy: true,
  },
  authFields: [
    { key: 'instanceUrl', label: 'Instance URL', type: 'url', required: true },
    { key: 'db', label: 'Database Name', type: 'text', required: true },
    { key: 'username', label: 'Username / Email', type: 'text', required: true },
    { key: 'apiKey', label: 'API Key', type: 'password', required: true },
  ],
};
