import './adapters';

export { registerImporter, getImporter, listImporters } from './registry';
export type {
  ImporterAdapter, ImporterManifest, ImportedTask, AuthPayload, AuthType, ImportProgress,
} from './types';
export { fetchViaProxy, connectViaProxy } from './importProxyClient';
export {
  startOAuthFlow, deleteConnection, getConnection, getOAuthUrl,
  readConnectionMeta, listConnections, type ConnectionMeta, type StoredConnection,
} from './oauthClient';
export { guessStageMapping, type StageMapping } from './statusMapper';
export {
  getLastUsedImport, setLastUsedImport, type LastUsedImport,
} from './importPreferences';
export { buildPipelineImportPlan, type PipelineImportPlan } from './pipelinePlan';
