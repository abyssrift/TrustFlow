export const ONBOARDING_MANIFEST_KEY = 'onboarding_preset.manifest';

export const SIZE_BANDS = ['solo', 'small', 'growing', 'scaling'] as const;
export type SizeBand = typeof SIZE_BANDS[number];

export const OPERATING_MODELS = [
  'client_delivery',
  'internal_operations',
  'product_development',
  'portfolio_intake',
  'governed_regulatory',
] as const;
export type OperatingModel = typeof OPERATING_MODELS[number];

export const GATE_OPTIONS = ['none', 'light', 'formal'] as const;
export type GatePreference = typeof GATE_OPTIONS[number];
export const TIME_OPTIONS = ['off', 'optional', 'required'] as const;
export type TimeTrackingPreference = typeof TIME_OPTIONS[number];
export const FILE_OPTIONS = ['light', 'centralized', 'governed'] as const;
export type FilePreference = typeof FILE_OPTIONS[number];
export const REPEAT_OPTIONS = ['rare', 'sometimes', 'frequent'] as const;
export type RepeatingWorkPreference = typeof REPEAT_OPTIONS[number];

export const EXPERIENCE_LEVELS = ['guided', 'full_control'] as const;
export type ExperienceLevel = typeof EXPERIENCE_LEVELS[number];
export const DEFAULT_EXPERIENCE_LEVEL: ExperienceLevel = 'guided';

export type OnboardingAnswers = {
  experienceLevel?: ExperienceLevel;
  sizeBand?: SizeBand;
  operatingModels?: OperatingModel[];
  gates?: GatePreference;
  timeTracking?: TimeTrackingPreference;
  files?: FilePreference;
  repeatingWork?: RepeatingWorkPreference;
};

export type OnboardingQuestionOption = {
  value: string;
  label: string;
  description?: string;
};

export type OnboardingQuestion = {
  key: string;
  type: 'single' | 'multi';
  label: string;
  description: string;
  required: boolean;
  options: OnboardingQuestionOption[];
  visibleWhen?: { answer: string; values: string[] };
};

export type OnboardingCatalogEntry = {
  catalog_key?: unknown;
  version?: unknown;
  payload?: unknown;
};

export type OnboardingCatalogManifest = {
  catalogKey: typeof ONBOARDING_MANIFEST_KEY;
  version: number;
  questions: OnboardingQuestion[];
};

export type OnboardingPreset = {
  catalogKey: string;
  version: number;
  presetType: 'size_band' | 'operating_model_overlay';
  selectionKey: SizeBand | OperatingModel;
  label: string;
  recommendations: {
    workflow: string[];
    gates: string[];
    time: string[];
    files: string[];
    repeatingWork: string[];
    tutorialTopics: string[];
  };
  guarantees: {
    admin: string[];
    member: string[];
    tutorialTopics: string[];
  };
  safeDefaults: Record<string, boolean | string | number>;
  deferred: string[];
};

export type ResolvedOnboardingProfile = {
  experienceLevel: ExperienceLevel;
  sizeBand: SizeBand;
  operatingModels: OperatingModel[];
  selectedCatalogKeys: string[];
  selectedCatalogVersions: Array<{ catalogKey: string; version: number; role: 'size_band' | 'operating_model_overlay' }>;
  recommendations: OnboardingPreset['recommendations'];
  guarantees: OnboardingPreset['guarantees'];
  safeDefaults: Record<string, boolean | string | number>;
  deferred: string[];
};

/** Keep the wire contract snake_case while the UI state stays idiomatic TS. */
export function onboardingAnswersForRpc(answers: OnboardingAnswers): Record<string, unknown> {
  return {
    experience_level: answers.experienceLevel ?? DEFAULT_EXPERIENCE_LEVEL,
    ...(answers.sizeBand ? { size_band: answers.sizeBand } : {}),
    ...(answers.operatingModels ? { operating_models: answers.operatingModels } : {}),
    ...(answers.gates ? { gates: answers.gates } : {}),
    ...(answers.timeTracking ? { time_tracking: answers.timeTracking } : {}),
    ...(answers.files ? { files: answers.files } : {}),
    ...(answers.repeatingWork ? { repeating_work: answers.repeatingWork } : {}),
  };
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && values.includes(value as T[number]);
}

function nonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function parseQuestion(value: unknown): OnboardingQuestion | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (!isString(candidate.key) || (candidate.type !== 'single' && candidate.type !== 'multi') || !isString(candidate.label) || !isString(candidate.description)) return null;
  if (typeof candidate.required !== 'boolean' || !Array.isArray(candidate.options) || candidate.options.length === 0) return null;
  const options = candidate.options.flatMap((option) => {
    if (!option || typeof option !== 'object') return [];
    const item = option as Record<string, unknown>;
    if (!isString(item.value) || !isString(item.label)) return [];
    return [{
      value: item.value,
      label: item.label,
      // ponytail: catalog text ships typographic dashes (U+2012-U+2015) that render as "?" tofu
      // in this app's bundled fonts on some platforms — normalize to ASCII hyphen at parse time.
      ...(isString(item.description) ? { description: item.description.replace(/[‒-―]/g, '-') } : {}),
    }];
  });
  if (options.length !== candidate.options.length || new Set(options.map((option) => option.value)).size !== options.length) return null;
  return {
    key: candidate.key,
    type: candidate.type,
    label: candidate.label,
    description: candidate.description,
    required: candidate.required,
    options,
    ...((candidate.visibleWhen ?? candidate.visible_when) && typeof (candidate.visibleWhen ?? candidate.visible_when) === 'object' ? {
      visibleWhen: {
        answer: String(((candidate.visibleWhen ?? candidate.visible_when) as Record<string, unknown>).answer ?? ''),
        values: Array.isArray(((candidate.visibleWhen ?? candidate.visible_when) as Record<string, unknown>).values)
          ? ((((candidate.visibleWhen ?? candidate.visible_when) as Record<string, unknown>).values) as unknown[]).filter(isString)
          : [],
      },
    } : {}),
  };
}

export function parseOnboardingCatalogManifest(entry: OnboardingCatalogEntry): OnboardingCatalogManifest {
  const payload = entry.payload as Record<string, unknown> | undefined;
  const version = entry.version;
  const questions = Array.isArray(payload?.questions) ? payload.questions.map(parseQuestion) : [];
  if (
    entry.catalog_key !== ONBOARDING_MANIFEST_KEY
    || typeof version !== 'number'
    || !Number.isInteger(version)
    || version < 1
    || payload?.schema_version !== 1
    || questions.length === 0
    || questions.some((question) => question === null)
    || new Set(questions.map((question) => question?.key)).size !== questions.length
  ) {
    throw new Error('Invalid onboarding catalog manifest');
  }
  return { catalogKey: ONBOARDING_MANIFEST_KEY, version, questions: questions as OnboardingQuestion[] };
}

export function parseOnboardingPresetEntry(entry: OnboardingCatalogEntry): OnboardingPreset {
  const payload = entry.payload as Record<string, unknown> | undefined;
  const version = entry.version;
  const presetType = payload?.preset_type;
  const selectionKey = payload?.selection_key;
  const recommendations = payload?.recommendations as Record<string, unknown> | undefined;
  const safeDefaults = payload?.safe_defaults as Record<string, unknown> | undefined;
  if (
    !isString(entry.catalog_key)
    || !entry.catalog_key.startsWith('onboarding_preset.')
    || typeof version !== 'number'
    || !Number.isInteger(version)
    || version < 1
    || payload?.schema_version !== 1
    || (presetType !== 'size_band' && presetType !== 'operating_model_overlay')
    || !isString(selectionKey)
    || !isString(payload.label)
    || !recommendations
    || !nonEmptyStringArray(recommendations.workflow)
    || !nonEmptyStringArray(recommendations.gates)
    || !nonEmptyStringArray(recommendations.time)
    || !nonEmptyStringArray(recommendations.files)
    || !nonEmptyStringArray(recommendations.repeating_work)
    || !nonEmptyStringArray(recommendations.tutorial_topics)
    || !safeDefaults
    || typeof safeDefaults.feature_settings !== 'object'
    || safeDefaults.feature_settings === null
    || !nonEmptyStringArray(payload.deferred)
  ) {
    throw new Error('Invalid onboarding preset catalog entry');
  }
  if (presetType === 'size_band' && !isOneOf(SIZE_BANDS, selectionKey)) throw new Error('Invalid onboarding preset catalog entry');
  if (presetType === 'operating_model_overlay' && !isOneOf(OPERATING_MODELS, selectionKey)) throw new Error('Invalid onboarding preset catalog entry');
  const featureSettings = Object.fromEntries(
    Object.entries(safeDefaults.feature_settings).filter(([, value]) => ['boolean', 'string', 'number'].includes(typeof value)),
  ) as Record<string, boolean | string | number>;
  return {
    catalogKey: entry.catalog_key,
    version,
    presetType,
    selectionKey: selectionKey as SizeBand | OperatingModel,
    label: payload.label,
    recommendations: {
      workflow: recommendations.workflow,
      gates: recommendations.gates,
      time: recommendations.time,
      files: recommendations.files,
      repeatingWork: recommendations.repeating_work,
      tutorialTopics: recommendations.tutorial_topics,
    },
    guarantees: {
      admin: nonEmptyStringArray(payload.guarantees && (payload.guarantees as Record<string, unknown>).admin)
        ? (payload.guarantees as Record<string, string[]>).admin : [],
      member: nonEmptyStringArray(payload.guarantees && (payload.guarantees as Record<string, unknown>).member)
        ? (payload.guarantees as Record<string, string[]>).member : [],
      tutorialTopics: nonEmptyStringArray(payload.guarantees && (payload.guarantees as Record<string, unknown>).tutorial_topics)
        ? (payload.guarantees as Record<string, string[]>).tutorial_topics : [],
    },
    safeDefaults: featureSettings,
    deferred: payload.deferred,
  };
}

const MODEL_ORDER: OperatingModel[] = [...OPERATING_MODELS];

export function deriveOnboardingSteps(answers: OnboardingAnswers, manifest?: OnboardingCatalogManifest): string[] {
  if (manifest) {
    const answerValue = (key: string): unknown => {
      if (key === 'size_band') return answers.sizeBand;
      if (key === 'operating_models') return answers.operatingModels;
      if (key === 'gates') return answers.gates;
      if (key === 'time_tracking') return answers.timeTracking;
      if (key === 'files') return answers.files;
      if (key === 'repeating_work') return answers.repeatingWork;
      return undefined;
    };
    return manifest.questions
      .filter((question) => {
        if (!question.visibleWhen) return true;
        const current = answerValue(question.visibleWhen.answer);
        return Array.isArray(current)
          ? current.some((value) => question.visibleWhen!.values.includes(String(value)))
          : question.visibleWhen.values.includes(String(current ?? ''));
      })
      .map((question) => question.key);
  }
  const steps = ['size_band', 'operating_models'];
  const models = answers.operatingModels ?? [];
  if (models.some((model) => model === 'client_delivery' || model === 'governed_regulatory')) steps.push('gates');
  if (models.some((model) => model === 'client_delivery' || model === 'product_development' || model === 'governed_regulatory')) steps.push('time_tracking');
  if (models.some((model) => model === 'client_delivery' || model === 'portfolio_intake' || model === 'governed_regulatory')) steps.push('files');
  steps.push('repeating_work');
  return steps;
}

export function pruneStaleOnboardingAnswers(answers: OnboardingAnswers, manifest?: OnboardingCatalogManifest): OnboardingAnswers {
  const allowed = new Set(deriveOnboardingSteps(answers, manifest));
  return {
    ...(answers.experienceLevel ? { experienceLevel: answers.experienceLevel } : {}),
    ...(answers.sizeBand ? { sizeBand: answers.sizeBand } : {}),
    ...(answers.operatingModels ? { operatingModels: answers.operatingModels } : {}),
    ...(allowed.has('gates') && answers.gates ? { gates: answers.gates } : {}),
    ...(allowed.has('time_tracking') && answers.timeTracking ? { timeTracking: answers.timeTracking } : {}),
    ...(allowed.has('files') && answers.files ? { files: answers.files } : {}),
    ...(allowed.has('repeating_work') && answers.repeatingWork ? { repeatingWork: answers.repeatingWork } : {}),
  };
}

export function validateOnboardingAnswers(answers: OnboardingAnswers, manifest?: OnboardingCatalogManifest): string[] {
  const errors: string[] = [];
  if (answers.experienceLevel !== undefined && !isOneOf(EXPERIENCE_LEVELS, answers.experienceLevel)) errors.push('Choose an experience level.');
  if (!answers.sizeBand || !isOneOf(SIZE_BANDS, answers.sizeBand)) errors.push('Choose a team size.');
  if (!answers.operatingModels || answers.operatingModels.length === 0 || answers.operatingModels.some((model) => !isOneOf(OPERATING_MODELS, model)) || new Set(answers.operatingModels).size !== answers.operatingModels.length) errors.push('Choose at least one work type.');
  const steps = deriveOnboardingSteps(answers, manifest);
  if (steps.includes('gates') && !isOneOf(GATE_OPTIONS, answers.gates)) errors.push('Choose an approval preference.');
  if (steps.includes('time_tracking') && !isOneOf(TIME_OPTIONS, answers.timeTracking)) errors.push('Choose a time-tracking preference.');
  if (steps.includes('files') && !isOneOf(FILE_OPTIONS, answers.files)) errors.push('Choose a file-sharing preference.');
  if (!isOneOf(REPEAT_OPTIONS, answers.repeatingWork)) errors.push('Choose how often work repeats.');
  return errors;
}

function appendUnique(target: string[], values: string[]) {
  for (const value of values) if (!target.includes(value)) target.push(value);
}

export function resolveOnboardingProfile(answers: OnboardingAnswers, presets: OnboardingPreset[], manifest?: OnboardingCatalogManifest): ResolvedOnboardingProfile {
  const errors = validateOnboardingAnswers(answers, manifest);
  if (errors.length > 0) throw new Error(errors.join(' '));
  const sizeBand = answers.sizeBand as SizeBand;
  const operatingModels = [...(answers.operatingModels as OperatingModel[])].sort((a, b) => MODEL_ORDER.indexOf(a) - MODEL_ORDER.indexOf(b));
  const selected = [
    presets.find((preset) => preset.presetType === 'size_band' && preset.selectionKey === sizeBand),
    ...operatingModels.map((model) => presets.find((preset) => preset.presetType === 'operating_model_overlay' && preset.selectionKey === model)),
  ];
  if (selected.some((preset) => !preset)) throw new Error('The selected onboarding preset is unavailable.');
  const recommendations: ResolvedOnboardingProfile['recommendations'] = {
    workflow: [], gates: [], time: [], files: [], repeatingWork: [], tutorialTopics: [],
  };
  const guarantees: ResolvedOnboardingProfile['guarantees'] = {
    admin: [], member: [], tutorialTopics: [],
  };
  const safeDefaults: Record<string, boolean | string | number> = {};
  const deferred: string[] = [];
  const selectedCatalogVersions = selected.map((preset) => ({
    catalogKey: (preset as OnboardingPreset).catalogKey,
    version: (preset as OnboardingPreset).version,
    role: (preset as OnboardingPreset).presetType,
  }));
  for (const preset of selected as OnboardingPreset[]) {
    appendUnique(recommendations.workflow, preset.recommendations.workflow);
    appendUnique(recommendations.gates, preset.recommendations.gates);
    appendUnique(recommendations.time, preset.recommendations.time);
    appendUnique(recommendations.files, preset.recommendations.files);
    appendUnique(recommendations.repeatingWork, preset.recommendations.repeatingWork);
    appendUnique(recommendations.tutorialTopics, preset.recommendations.tutorialTopics);
    appendUnique(guarantees.admin, preset.guarantees.admin);
    appendUnique(guarantees.member, preset.guarantees.member);
    appendUnique(guarantees.tutorialTopics, preset.guarantees.tutorialTopics);
    Object.assign(safeDefaults, preset.safeDefaults);
    appendUnique(deferred, preset.deferred);
  }
  return {
    experienceLevel: answers.experienceLevel ?? DEFAULT_EXPERIENCE_LEVEL,
    sizeBand,
    operatingModels,
    selectedCatalogKeys: selectedCatalogVersions.map((entry) => entry.catalogKey),
    selectedCatalogVersions,
    recommendations,
    guarantees,
    safeDefaults,
    deferred,
  };
}

export async function loadOnboardingCatalog(client: {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}): Promise<{ manifest: OnboardingCatalogManifest; presets: OnboardingPreset[] } | null> {
  const { data, error } = await client.rpc('rpc_list_onboarding_preset_catalog', {});
  if (error || !data || typeof data !== 'object') return null;
  const payload = data as { manifest?: unknown; presets?: unknown };
  try {
    const manifest = parseOnboardingCatalogManifest(payload.manifest as OnboardingCatalogEntry);
    const presets = Array.isArray(payload.presets)
      ? payload.presets.map((entry) => parseOnboardingPresetEntry(entry as OnboardingCatalogEntry))
      : [];
    return presets.length > 0 ? { manifest, presets } : null;
  } catch {
    return null;
  }
}
