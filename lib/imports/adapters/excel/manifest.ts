import type { ImporterManifest } from '@/lib/imports/types';

export const manifest: ImporterManifest = {
  id: 'excel',
  displayName: 'Excel / CSV',
  icon: 'file-excel-o',
  authType: 'file',
  capabilities: {
    supportsComments: false,
    supportsAttachments: false,
    supportsHierarchy: false,
  },
};
