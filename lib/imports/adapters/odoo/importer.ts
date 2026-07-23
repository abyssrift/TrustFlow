import { registerImporter } from '@/lib/imports/registry';
import type { ImporterAdapter, ImportedTask, AuthPayload } from '@/lib/imports/types';
import { fetchViaProxy } from '@/lib/imports/importProxyClient';
import { htmlToText } from '@/lib/imports/htmlToText';
import { manifest } from './manifest';

// Odoo's default project.task priority selection is 2-level: '0' Normal, '1' High.
// ponytail: extend if a customised selection (2/3) is ever encountered.
const priorityMap: Record<string, string> = { '0': 'medium', '1': 'high' };

const odooImporter: ImporterAdapter = {
  manifest,

  // Credentials (db/username/apiKey/instanceUrl) are stored server-side via the
  // connect step, so fetches carry only the resource selector.
  async fetchProjects(_auth: AuthPayload): Promise<any[]> {
    const raw = await fetchViaProxy('odoo', 'projects');
    return Array.isArray(raw) ? raw : [];
  },

  async fetchTasks(_auth: AuthPayload, projectId: string): Promise<any[]> {
    const raw = await fetchViaProxy('odoo', 'tasks', { projectId });
    return Array.isArray(raw) ? raw : [];
  },

  mapToCanonical(raw: any[]): ImportedTask[] {
    return raw.map((task: any) => ({
      title: task.name || '',
      // Odoo `description` is an HTML field — flatten to plain text.
      description: htmlToText(task.description || ''),
      priority: priorityMap[String(task.priority)] || 'medium',
      category: null,
      // Proxy normalises assignees → emails on `_assignees` (handles the
      // Odoo 17 user_id → user_ids rename + res.users email lookup).
      assigneeEmails: Array.isArray(task._assignees) ? task._assignees : [],
      dueDate: task.date_deadline || null,
      tags: Array.isArray(task.tag_ids) ? task.tag_ids.map((t: any) => (Array.isArray(t) ? t[1] : String(t))) : [],
      externalId: String(task.id || ''),
      externalUrl: null,
      stageName: task.stage_id?.[1] || null,
    }));
  },
};

registerImporter(odooImporter);
