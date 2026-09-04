// Command-palette input modes + the `>` command registry (#346, #347).
//
// `parseInputMode` is the single place that reads the leading string of the
// palette query and decides what the palette is doing:
//   >…            → command mode (#346)   — runs a PaletteCommand
//   new task: / nt …    → inline quick-create a task (#347)
//   new project: / np … → inline quick-create a project (#347)
//   anything else       → normal search / go-to
// `>` wins over the create prefixes — they're mutually exclusive leading
// strings and the branching lives here, not scattered through the component.
//
// PALETTE_COMMANDS is a flat registry so more commands are a one-line push.
// Each `run` gets a ctx object the component builds from its own hooks — the
// registry itself imports no React.
import type { IconName } from './constants';
import { THEME_OPTIONS } from './constants';
import type { ThemeType } from '@/contexts/ThemeContext';

export type InputModeKind = 'command' | 'create-task' | 'create-project' | 'normal';
export type ParsedInput = { mode: InputModeKind; text: string };

// case-insensitive leading strings → mode. Order matters only in that the
// `>` check runs first, below.
const CREATE_PREFIXES: { prefix: string; mode: InputModeKind }[] = [
  { prefix: 'new task:', mode: 'create-task' },
  { prefix: 'nt ', mode: 'create-task' },
  { prefix: 'new project:', mode: 'create-project' },
  { prefix: 'np ', mode: 'create-project' },
];

export function parseInputMode(query: string): ParsedInput {
  if (query.startsWith('>')) return { mode: 'command', text: query.slice(1).trim() };
  const lower = query.toLowerCase();
  for (const { prefix, mode } of CREATE_PREFIXES) {
    if (lower.startsWith(prefix)) return { mode, text: query.slice(prefix.length).trim() };
  }
  return { mode: 'normal', text: query };
}

export type PaletteCommandCtx = {
  theme: ThemeType;
  setTheme: (t: ThemeType) => void;
  pathname: string;
  signOut: () => Promise<void>;
  successToast: (msg: string, title?: string) => void;
  errorToast: (msg: string, title?: string) => void;
  close: () => void;
};

export type PaletteCommand = {
  id: string;
  label: string;
  icon: IconName;
  hint?: string;
  permission?: string;
  run: (ctx: PaletteCommandCtx) => void | Promise<void>;
};

// Sidebar collapse/expand was specced here too but is omitted:
// #346 follow-up: Sidebar.web.tsx reads `sidebar_collapsed` once in a useState
// initializer with no `storage` listener and no cross-component signal, so a
// palette-side localStorage write can't take effect without a full reload.
// Add a shared collapse store (or a storage-event listener in Sidebar) first.
export const PALETTE_COMMANDS: PaletteCommand[] = [
  {
    id: 'toggle-theme',
    label: 'Toggle theme',
    icon: 'adjust',
    hint: 'cycle',
    run: (ctx) => {
      const ids = THEME_OPTIONS.map((o) => o.id);
      const i = ids.indexOf(ctx.theme);
      ctx.setTheme(ids[(i + 1) % ids.length]);
      // stays open — let the user keep cycling
    },
  },
  {
    id: 'copy-page-link',
    label: 'Copy page link',
    icon: 'link',
    run: async (ctx) => {
      try {
        await navigator.clipboard.writeText(window.location.origin + ctx.pathname);
        ctx.successToast('Link copied');
      } catch {
        ctx.errorToast('Could not copy link');
      }
      ctx.close();
    },
  },
  {
    id: 'sign-out',
    label: 'Sign out',
    icon: 'sign-out',
    run: async (ctx) => {
      ctx.close();
      await ctx.signOut();
    },
  },
];
