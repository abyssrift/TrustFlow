import { registerImporter } from '@/lib/imports/registry';
import type { ImporterAdapter, ImportedTask, AuthPayload } from '@/lib/imports/types';
import { fetchViaProxy } from '@/lib/imports/importProxyClient';
import { manifest } from './manifest';

const trelloImporter: ImporterAdapter = {
  manifest,

  async fetchProjects(_auth: AuthPayload): Promise<any[]> {
    const raw = await fetchViaProxy('trello', 'projects', { memberId: 'me' });
    return Array.isArray(raw) ? raw : [];
  },

  // The proxy returns the board's lists each with their open cards, so we can
  // flatten to cards while tagging each with its list (= stage) name.
  async fetchTasks(_auth: AuthPayload, boardId: string): Promise<any[]> {
    const lists = await fetchViaProxy('trello', 'tasks', { boardId });
    if (!Array.isArray(lists)) return [];
    return lists.flatMap((list: any) =>
      (list.cards ?? []).map((c: any) => ({ ...c, _stageName: list.name })));
  },

  mapToCanonical(raw: any[]): ImportedTask[] {
    return raw.map((card: any) => ({
      title: card.name || '',
      description: card.desc || '',
      priority: 'medium',
      category: null,
      // Trello exposes member IDs (idMembers), not emails — email resolution
      // would need a per-member lookup; leave unassigned for now.
      assigneeEmails: [],
      dueDate: card.due || null,
      tags: card.labels?.map((l: any) => l.name || l.color).filter(Boolean) || [],
      externalId: card.id || '',
      externalUrl: card.url || null,
      stageName: card._stageName || null,
    }));
  },
};

registerImporter(trelloImporter);
