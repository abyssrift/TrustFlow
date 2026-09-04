// #324 (command-palette P2c): let a URL open a create/compose modal.
//
// One central listener — mounted once inside <ModalHost> — instead of a
// useLocalSearchParams effect bolted onto all six create-capable screens. A
// link like `/tasks?new=1&type=task&pipelineId=p1` or
// `/projects?new=1&type=project&portfolioId=abc` navigates in, this fires
// summon() once, then strips the seed params so refresh / back / closing the
// modal never re-triggers it.
//
// Uses useGlobalSearchParams, NOT useLocalSearchParams: <ModalHost> lives in
// the root _layout, outside the focused route, and useLocalSearchParams only
// resolves params for the component's own route (it would read `{}` here).
// expo-router's own docs point at useGlobalSearchParams for exactly this
// "background operation that doesn't draw to the screen" case. Same on native
// (deep links / router.push with a query string).
import { useEffect, useRef } from 'react';
import { useGlobalSearchParams, useRouter } from 'expo-router';

import { useModalDispatch, type ActiveModal } from '@/contexts/ModalDispatchContext';

// `type=` param value -> wired ModalType. `portfolio` is still unwired in
// ModalHost — ignored silently. #324: unwired, see #339 (create-portfolio).
const TYPE_TO_MODAL = {
  task: 'create-task',
  project: 'create-project',
  report: 'generate-report',
  role: 'new-role',
  upload: 'upload',
} as const;

// Params this hook recognises — and therefore also strips once it has fired.
export const SEED_PARAM_KEYS = ['new', 'type', 'projectId', 'pipelineId', 'portfolioId', 'folderId', 'taskId'] as const;

type RawParams = Partial<Record<(typeof SEED_PARAM_KEYS)[number], string | string[]>>;

const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

/**
 * Pure mapper — no React, no expo-router, unit-testable on its own. Given the
 * raw query params, returns the ModalHost-ready `{ type, payload }` or null
 * when there is nothing to summon (no `new`, or an unrecognised / unwired
 * `type`). Payloads carry only the seed params relevant to that modal.
 */
export function mapModalQueryParams(params: RawParams): ActiveModal | null {
  if (!first(params.new)) return null;
  const modalType = TYPE_TO_MODAL[first(params.type) as keyof typeof TYPE_TO_MODAL];
  if (!modalType) return null; // unrecognised or unwired — #324: unwired, see #323

  if (modalType === 'create-task') {
    const payload: { projectId?: string; pipelineId?: string } = {};
    const projectId = first(params.projectId);
    const pipelineId = first(params.pipelineId);
    if (projectId) payload.projectId = projectId;
    if (pipelineId) payload.pipelineId = pipelineId;
    return { type: 'create-task', payload };
  }
  if (modalType === 'create-project') {
    const payload: { portfolioId?: string } = {};
    const portfolioId = first(params.portfolioId);
    if (portfolioId) payload.portfolioId = portfolioId;
    return { type: 'create-project', payload };
  }
  if (modalType === 'upload') {
    const payload: { folderId?: string; taskId?: string } = {};
    const folderId = first(params.folderId);
    const taskId = first(params.taskId);
    if (folderId) payload.folderId = folderId;
    if (taskId) payload.taskId = taskId;
    return { type: 'upload', payload };
  }
  // generate-report and new-role take no seed params.
  return { type: modalType, payload: {} };
}

export function useModalQueryParam(): void {
  const params = useGlobalSearchParams<RawParams>();
  const { summon } = useModalDispatch();
  const router = useRouter();
  // Flipped BEFORE summon so a re-render while the params are still present
  // (they clear a tick later) can't summon twice. Reset once `new` is gone,
  // re-arming the hook for a later ?new= appearance.
  const handled = useRef(false);

  useEffect(() => {
    if (!first(params.new)) {
      handled.current = false;
      return;
    }
    if (handled.current) return;
    handled.current = true;

    const result = mapModalQueryParams(params);
    // Strip the seed params whether or not we matched: on a match so closing
    // the modal leaves no stale ?new=1 in the URL; on a miss (unwired type) so
    // the ignored link doesn't sit there forever. Same router.setParams({ x:
    // undefined }) clear pattern FileHub's ?file= deep link uses.
    router.setParams(
      Object.fromEntries(SEED_PARAM_KEYS.map((k) => [k, undefined])) as Record<string, undefined>,
    );
    if (result) summon(result.type, result.payload as never);
  }, [params, summon, router]);
}
