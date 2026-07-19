import { registerImporter } from '@/lib/imports/registry';
import type { ImporterAdapter, ImportedTask, AuthPayload } from '@/lib/imports/types';
import { bytesToRows, parseImportRows, type ImportLookups } from '@/lib/taskMobility';
import { manifest } from './manifest';

const excelImporter: ImporterAdapter = {
  manifest,
  async mapToCanonical(raw: any[]): Promise<ImportedTask[]> {
    return raw.map((r: any) => ({
      title: r.Title || '',
      description: r.Description || '',
      priority: (r.Priority || 'normal').toLowerCase(),
      category: r.Category || null,
      assigneeEmails: r.Assignees ? r.Assignees.split(/[;,]/).map((e: string) => e.trim()).filter(Boolean) : [],
      dueDate: r['Due Date'] || null,
      tags: [],
      externalId: '',
      externalUrl: null,
      stageName: null,
    }));
  },
};

registerImporter(excelImporter);
