import { registerImporter } from '@/lib/imports/registry';
import type { ImporterAdapter, ImportedTask, AuthPayload } from '@/lib/imports/types';
import { fetchViaProxy } from '@/lib/imports/importProxyClient';
import { manifest } from './manifest';

const priorityMap: Record<number, string> = {
  0: 'low',
  1: 'medium',
  2: 'high',
  3: 'urgent',
};

const odooImporter: ImporterAdapter = {
  manifest,

  async fetchProjects(auth: AuthPayload): Promise<any[]> {
    const raw = await fetchViaProxy('odoo', 'projects', auth, {
      db: auth.db || '',
      username: auth.username || '',
    });
    return Array.isArray(raw) ? raw : [];
  },

  async fetchTasks(auth: AuthPayload, projectId: string): Promise<any[]> {
    const raw = await fetchViaProxy('odoo', 'tasks', auth, {
      projectId,
      db: auth.db || '',
      username: auth.username || '',
    });
    return Array.isArray(raw) ? raw : [];
  },

  mapToCanonical(raw: any[]): ImportedTask[] {
    return raw.map((task: any) => ({
      title: task.name || '',
      description: task.description || '',
      priority: priorityMap[task.priority] || 'medium',
      category: null,
      assigneeEmails: task.user_id?.[1] ? [task.user_id[1]] : [],
      dueDate: task.date_deadline || null,
      tags: Array.isArray(task.tag_ids) ? task.tag_ids.map((t: any) => (Array.isArray(t) ? t[1] : String(t))) : [],
      externalId: String(task.id || ''),
      externalUrl: null,
      stageName: task.stage_id?.[1] || null,
    }));
  },
};

registerImporter(odooImporter);
