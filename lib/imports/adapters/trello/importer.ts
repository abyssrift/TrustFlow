import { registerImporter } from '@/lib/imports/registry';
import type { ImporterAdapter, ImportedTask, AuthPayload } from '@/lib/imports/types';
import { fetchViaProxy } from '@/lib/imports/importProxyClient';
import { manifest } from './manifest';

const trelloImporter: ImporterAdapter = {
  manifest,

  async fetchProjects(auth: AuthPayload): Promise<any[]> {
    const memberId = auth.instanceUrl || 'me';
    const raw = await fetchViaProxy('trello', 'projects', auth, { memberId });
    return Array.isArray(raw) ? raw : [];
  },

  async fetchTasks(auth: AuthPayload, boardId: string): Promise<any[]> {
    const raw = await fetchViaProxy('trello', 'tasks', auth, { boardId });
    return Array.isArray(raw) ? raw : [];
  },

  mapToCanonical(raw: any[]): ImportedTask[] {
    return raw.map((card: any) => ({
      title: card.name || '',
      description: card.desc || '',
      priority: 'medium',
      category: null,
      assigneeEmails: card.idMembers?.length ? [] : [], // member IDs resolved separately
      dueDate: card.due || null,
      tags: card.labels?.map((l: any) => l.name || l.color) || [],
      externalId: card.id || '',
      externalUrl: card.url || null,
      stageName: card.idList || null,
    }));
  },
};

registerImporter(trelloImporter);
