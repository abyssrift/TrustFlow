export type AuthType = 'oauth2' | 'api_key' | 'file';

export type ImporterManifest = {
  id: string;
  displayName: string;
  icon: string;
  authType: AuthType;
  providerId?: string;
  capabilities?: {
    supportsComments?: boolean;
    supportsAttachments?: boolean;
    supportsHierarchy?: boolean;
  };
  authFields?: { key: string; label: string; type: 'text' | 'password' | 'url'; required: boolean }[];
};

export interface ImporterAdapter {
  manifest: ImporterManifest;
  fetchProjects?(auth: AuthPayload): Promise<any[]>;
  fetchTasks?(auth: AuthPayload, projectId: string): Promise<any[]>;
  mapToCanonical(raw: any[]): ImportedTask[];
}

export type AuthPayload = {
  provider: string;
  tokens?: string;
  instanceUrl?: string;
  apiKey?: string;
  db?: string;
  username?: string;
};

export type ImportedTask = {
  title: string;
  description: string;
  priority: string;
  category: string | null;
  assigneeEmails: string[];
  dueDate: string | null;
  tags: string[];
  externalId: string;
  externalUrl: string | null;
  stageName: string | null;
};

export type ImportProgress = {
  done: number;
  total: number;
};
