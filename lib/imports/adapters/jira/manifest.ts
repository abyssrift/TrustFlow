import type { ImporterManifest } from '@/lib/imports/types';

export const manifest: ImporterManifest = {
  id: 'jira',
  displayName: 'Jira',
  icon: 'atlassian',
  authType: 'oauth2',
  providerId: 'jira',
  capabilities: {
    supportsComments: true,
    supportsAttachments: true,
    supportsHierarchy: true,
  },
};
