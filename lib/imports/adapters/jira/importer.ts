import { registerImporter } from '@/lib/imports/registry';
import type { ImporterAdapter, ImportedTask, AuthPayload } from '@/lib/imports/types';
import { fetchViaProxy } from '@/lib/imports/importProxyClient';
import { mapJiraRow } from '@/lib/jiraImport';
import { manifest } from './manifest';

// Jira API v3 returns descriptions as ADF (a nested rich-text object), not a
// string. Flatten the text nodes so we don't store "[object Object]".
function adfToText(node: any): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node.text === 'string') return node.text;
  const kids = Array.isArray(node.content) ? node.content : [];
  const suffix = node.type === 'paragraph' || node.type === 'heading' ? '\n' : '';
  return kids.map(adfToText).join('') + suffix;
}

const jiraImporter: ImporterAdapter = {
  manifest,

  // Credentials (token + cloudId) live server-side; these calls carry only the
  // resource selector.
  async fetchProjects(_auth: AuthPayload): Promise<any[]> {
    const raw = await fetchViaProxy('jira', 'projects');
    return Array.isArray(raw) ? raw : raw?.values ?? [];
  },

  async fetchTasks(_auth: AuthPayload, projectId: string): Promise<any[]> {
    const raw = await fetchViaProxy('jira', 'tasks', { jql: `project="${projectId}"` });
    return Array.isArray(raw) ? raw : raw?.issues ?? [];
  },

  mapToCanonical(raw: any[]): ImportedTask[] {
    // API-style rows carry `fields`; CSV/file rows do not.
    if (raw.length > 0 && raw[0].fields) {
      return raw.map((issue: any) => {
        const f = issue.fields || {};
        return {
          title: f.summary || '',
          description: adfToText(f.description).trim(),
          priority: f.priority?.name?.toLowerCase() || 'medium',
          category: f.issuetype?.name || null,
          assigneeEmails: f.assignee?.emailAddress ? [f.assignee.emailAddress] : [],
          dueDate: f.duedate || null,
          tags: f.labels || [],
          externalId: issue.key || issue.id,
          externalUrl: issue.self || null,
          stageName: f.status?.name || null,
        };
      });
    }
    // CSV path — use existing Jira bridge.
    return raw.map(mapJiraRow).map((r: Record<string, string>) => ({
      title: r.Title || '',
      description: r.Description || '',
      priority: r.Priority?.toLowerCase() || 'medium',
      category: r.Category || null,
      assigneeEmails: r.Assignees ? r.Assignees.split(/[;,]/).map(e => e.trim()).filter(Boolean) : [],
      dueDate: r['Due Date'] || null,
      tags: [],
      externalId: '',
      externalUrl: null,
      stageName: null,
    }));
  },
};

registerImporter(jiraImporter);
