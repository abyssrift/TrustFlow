import { registerImporter } from '@/lib/imports/registry';
import type { ImporterAdapter, ImportedTask, AuthPayload } from '@/lib/imports/types';
import { fetchViaProxy } from '@/lib/imports/importProxyClient';
import { isJiraExport, mapJiraRow } from '@/lib/jiraImport';
import { manifest } from './manifest';

const jiraImporter: ImporterAdapter = {
  manifest,

  async fetchProjects(auth: AuthPayload): Promise<any[]> {
    const raw = await fetchViaProxy('jira', 'projects', auth, {
      cloudId: auth.instanceUrl || '',
    });
    return Array.isArray(raw) ? raw : raw?.values ?? [];
  },

  async fetchTasks(auth: AuthPayload, projectId: string): Promise<any[]> {
    const raw = await fetchViaProxy('jira', 'tasks', auth, {
      cloudId: auth.instanceUrl || '',
      jql: `project=${projectId}`,
    });
    return Array.isArray(raw) ? raw : raw?.issues ?? [];
  },

  mapToCanonical(raw: any[]): ImportedTask[] {
    // Detect if raw rows are CSV-style (from file import) or API-style
    if (raw.length > 0 && raw[0].fields) {
      return raw.map((issue: any) => {
        const f = issue.fields || {};
        return {
          title: f.summary || '',
          description: f.description || '',
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
    // CSV path — use existing Jira bridge
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
