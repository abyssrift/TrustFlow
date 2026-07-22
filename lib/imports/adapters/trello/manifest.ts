import type { ImporterManifest } from '@/lib/imports/types';

export const manifest: ImporterManifest = {
  id: 'trello',
  displayName: 'Trello',
  icon: 'trello',
  authType: 'oauth2',
  providerId: 'trello',
  capabilities: {
    supportsComments: true,
    supportsAttachments: true,
    supportsHierarchy: false,
  },
};
