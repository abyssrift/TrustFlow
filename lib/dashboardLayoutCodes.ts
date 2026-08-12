// Layout presets and shareable layout codes for the dashboard widget system.
//
// Presets and codes are the SAME operation: take a list of widget entries →
// validate → apply. `buildLayout` is that one path; a preset and a decoded code
// are just two sources feeding it, so a preset containing a widget the viewer
// cannot see degrades exactly the way a pasted code does.
//
// No React, no react-native, no AsyncStorage — same split as
// lib/dashboardWidgets.ts, asserted by lib/dashboardLayoutCodes.check.ts.
// The React half is hooks/useDashboardLayout.ts (applyLayout/undoApply) and
// components/dashboard/widgets/WidgetPopups.tsx (the UI).

import {
  ALL_WIDGET_SIZES,
  WIDGET_META,
  addInstance,
  addWidgetBlock,
  isWidgetSize,
  isWidgetType,
  type WidgetInstance,
  type WidgetSize,
  type WidgetType,
} from './dashboardWidgets';

// ── The code format ──────────────────────────────────────────────────────

/**
 * `TFD` + format version + `-`. The version is IN the prefix so a code from a
 * future build is recognisable as a layout code and refused with a sentence
 * that helps, rather than falling through the base64 decoder as garbage.
 */
export const LAYOUT_CODE_PREFIX = 'TFD1-';
const PREFIX_SHAPE = /^TFD(\d+)-/;

/**
 * Hard cap on how many widgets one code may create. The registry ships 14
 * types and all but three are singletons, so a legitimate layout cannot come
 * near this — it exists so a hand-written code cannot mount hundreds of cards.
 */
export const MAX_CODE_INSTANCES = 24;

/** Length cap, applied before any decoding: nothing to parse past this. */
const MAX_CODE_CHARS = 4096;

// ── Results ──────────────────────────────────────────────────────────────

/** Why one entry did not become a widget. Shown to the user, so keep it honest. */
export type SkipReason = 'unknown' | 'permission' | 'duplicate' | 'over-cap';

export type SkippedWidget = { type: string; reason: SkipReason };

export type LayoutBuild = {
  instances: WidgetInstance[];
  skipped: SkippedWidget[];
};

export type LayoutDecode = LayoutBuild | { error: string };

export function isLayoutError(result: LayoutDecode): result is { error: string } {
  return 'error' in result;
}

/** What a preset declares per widget. Also the shape `buildLayout` validates. */
export type LayoutSeed = {
  type: WidgetType;
  size?: WidgetSize;
  config?: Record<string, string>;
};

/** The untrusted version of LayoutSeed — what a decoded code produces. */
type RawEntry = { type: unknown; size?: unknown; config?: unknown };

// ── The one validated apply path ─────────────────────────────────────────

/**
 * Turns entries from ANY source — a built-in preset or a pasted code — into
 * instances this viewer may actually render, plus what was dropped and why.
 *
 * Every rule here is delegated, never re-derived: `addWidgetBlock` decides
 * permission and singleton (the same predicate the Add picker uses), and
 * `addInstance` mints the id and the default size. Nothing in this file gets to
 * have its own opinion about what is addable.
 */
export function buildLayout(
  entries: readonly RawEntry[],
  can: (permission: string | null) => boolean,
): LayoutBuild {
  let out: WidgetInstance[] = [];
  const skipped: SkippedWidget[] = [];

  for (let idx = 0; idx < entries.length; idx++) {
    const entry = entries[idx];
    const label = typeof entry.type === 'string' ? entry.type : 'unknown widget';

    // Capped on the ENTRY index, not on how many survived: a code holding a
    // thousand entries must stop being read, not be read and then filtered.
    if (idx >= MAX_CODE_INSTANCES) {
      skipped.push({ type: label, reason: 'over-cap' });
      continue;
    }
    // A type this build does not ship — a code from a newer version. Dropped,
    // never fatal.
    if (!isWidgetType(entry.type)) {
      skipped.push({ type: label, reason: 'unknown' });
      continue;
    }

    const type: WidgetType = entry.type;
    const block = addWidgetBlock(type, out, can);
    if (block !== null) {
      skipped.push({ type, reason: block === 'permission' ? 'permission' : 'duplicate' });
      continue;
    }

    // addInstance appends with a fresh id and the type's default size; the
    // entry's own size/config are then applied on top, each clamped.
    const next = addInstance(out, type, can);
    const added = next[next.length - 1];
    next[next.length - 1] = {
      ...added,
      size: safeSize(type, entry.size),
      config: safeConfig(type, entry.config),
    };
    out = next;
  }

  return { instances: out, skipped };
}

/** Clamp: a size the type does not allow falls back to the size it prefers. */
function safeSize(type: WidgetType, raw: unknown): WidgetSize {
  const allowed = WIDGET_META[type].allowedSizes ?? ALL_WIDGET_SIZES;
  return isWidgetSize(raw) && allowed.includes(raw) ? raw : WIDGET_META[type].defaultSize;
}

/**
 * Config filtered THROUGH the registry rather than copied from the input: the
 * loop walks `configFields`, so a key the type does not declare has no way in,
 * and a value outside the declared options becomes that field's default.
 * A key that is simply absent stays absent — the widget reads its default at
 * render time, same as a freshly added instance.
 */
function safeConfig(type: WidgetType, raw: unknown): Record<string, string> {
  const src = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const out: Record<string, string> = {};
  for (const field of WIDGET_META[type].configFields) {
    // hasOwnProperty, not `in`: `in` walks the prototype chain, so a field ever
    // keyed `constructor` or `toString` would read as present on every entry.
    if (!Object.prototype.hasOwnProperty.call(src, field.key)) continue;
    const value = src[field.key];
    out[field.key] = field.options.some(o => o.value === value) ? (value as string) : field.default;
  }
  return out;
}

// ── Encoding ─────────────────────────────────────────────────────────────

/**
 * A UUID, or anything long enough to be an opaque handle. Not the primary
 * defence — see `shareableConfig` — but the one that would still hold if a
 * future widget type declared an id-valued option.
 */
const ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const looksLikeId = (value: string) => value.length > 32 || ID_SHAPE.test(value);

/**
 * The config that may leave this company. A code carries SHAPE, not SCOPE:
 * `DashboardConfig.pipelineIds` / `successStageIds` are not in scope here at
 * all (this function only ever sees a WidgetInstance), and an instance's own
 * config is emitted only when the value is one the REGISTRY declares as an
 * option — a closed, code-defined set that no company-scoped id can be a member
 * of. That is the structural guarantee; `looksLikeId` is the belt on top of it.
 */
function shareableConfig(instance: WidgetInstance): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const field of WIDGET_META[instance.type].configFields) {
    const value = instance.config[field.key];
    if (typeof value !== 'string') continue;
    if (!field.options.some(o => o.value === value)) continue;
    if (looksLikeId(value)) continue;
    out[field.key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * `TFD1-<base64url>` over a compact `[type, size, config?]` array. Instance ids
 * are NOT carried — the importer mints its own, so two dashboards built from
 * one code never share an id and a code never leaks a sequence number.
 */
export function encodeLayout(instances: readonly WidgetInstance[]): string {
  const body = instances.slice(0, MAX_CODE_INSTANCES).map(instance => {
    const config = shareableConfig(instance);
    return config ? [instance.type, instance.size, config] : [instance.type, instance.size];
  });
  return LAYOUT_CODE_PREFIX + toBase64Url(asciiJson(body));
}

// ── Decoding: a trust boundary ───────────────────────────────────────────

/** One sentence, reused, because "damaged" has exactly one useful response. */
const DAMAGED = 'That code is damaged. Copy it again and paste the whole thing.';

/**
 * A pasted code is untrusted input. Every failure returns a sentence the user
 * can act on; nothing here throws.
 */
export function decodeLayout(
  code: string,
  opts: { can: (permission: string | null) => boolean },
): LayoutDecode {
  const raw = code.trim();
  if (raw === '') return { error: 'Paste a layout code first.' };
  if (raw.length > MAX_CODE_CHARS) return { error: 'That code is too long to be a layout code.' };

  const version = PREFIX_SHAPE.exec(raw);
  if (!version) {
    return { error: `That doesn't look like a layout code — they start with ${LAYOUT_CODE_PREFIX}` };
  }
  if (version[1] !== '1') {
    return { error: 'That code came from a newer version of TrustFlow. Update the app, then paste it again.' };
  }

  const json = fromBase64Url(raw.slice(version[0].length));
  if (json === null) return { error: DAMAGED };

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { error: DAMAGED };
  }
  if (!Array.isArray(parsed)) return { error: DAMAGED };
  if (parsed.length === 0) return { error: 'That code has no widgets in it.' };

  const built = buildLayout(parsed.map(toEntry), opts.can);
  if (built.instances.length === 0) {
    // Replacing a working dashboard with nothing is never what the user meant.
    return built.skipped.some(s => s.reason === 'permission')
      ? { error: "None of the widgets in that code are ones you have access to." }
      : { error: 'None of the widgets in that code exist in this version of TrustFlow.' };
  }
  return built;
}

/** `[type, size, config?]` → RawEntry. Anything else becomes an unknown type. */
function toEntry(value: unknown): RawEntry {
  if (!Array.isArray(value)) return { type: null };
  return { type: value[0], size: value[1], config: value[2] };
}

// ── base64url ────────────────────────────────────────────────────────────
// Hand-rolled, ~30 lines, because `btoa`/`atob` are not reliably present in the
// React Native runtime and this must not cost a dependency. Bytes in, bytes
// out: the payload is forced to ASCII by `asciiJson` first, so a charCode IS a
// byte and no UTF-8 layer is needed.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** JSON with every non-ASCII char escaped to `\uXXXX`, which JSON.parse undoes. */
function asciiJson(value: unknown): string {
  const json = JSON.stringify(value);
  let out = '';
  for (let i = 0; i < json.length; i++) {
    const code = json.charCodeAt(i);
    out += code < 128 ? json[i] : '\\u' + code.toString(16).padStart(4, '0');
  }
  return out;
}

function toBase64Url(ascii: string): string {
  let out = '';
  for (let i = 0; i < ascii.length; i += 3) {
    const a = ascii.charCodeAt(i);
    const hasB = i + 1 < ascii.length;
    const hasC = i + 2 < ascii.length;
    const b = hasB ? ascii.charCodeAt(i + 1) : 0;
    const c = hasC ? ascii.charCodeAt(i + 2) : 0;
    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 3) << 4) | (b >> 4)];
    if (!hasB) break;
    out += ALPHABET[((b & 15) << 2) | (c >> 6)];
    if (!hasC) break;
    out += ALPHABET[c & 63];
  }
  return out;
}

/** null — never a throw — for any character or length that cannot be base64url. */
function fromBase64Url(encoded: string): string | null {
  if (encoded === '' || /[^A-Za-z0-9\-_]/.test(encoded)) return null;
  // A group of 1 char carries 6 bits: not enough for a byte, so it is corruption.
  if (encoded.length % 4 === 1) return null;

  let out = '';
  for (let i = 0; i < encoded.length; i += 4) {
    const at = (k: number) => (i + k < encoded.length ? ALPHABET.indexOf(encoded[i + k]) : -1);
    const n0 = at(0), n1 = at(1), n2 = at(2), n3 = at(3);
    out += String.fromCharCode(((n0 << 2) | (n1 >> 4)) & 255);
    if (n2 !== -1) out += String.fromCharCode(((n1 << 4) | (n2 >> 2)) & 255);
    if (n3 !== -1) out += String.fromCharCode(((n2 << 6) | n3) & 255);
  }
  return out;
}

// ── Built-in presets ─────────────────────────────────────────────────────

export type LayoutPreset = {
  id: string;
  name: string;
  /** One line, shown under the name. Says who it is for, not what it contains. */
  blurb: string;
  instances: readonly LayoutSeed[];
};

/**
 * Three starting points, one per way people actually use this dashboard. They
 * are deliberately NOT the seed (lib/dashboardWidgets.ts SEED_ORDER): the seed
 * is the safe middle a new device gets, these are the opinionated ends of it.
 *
 * Each runs through `buildLayout`, so a preset naming a widget the viewer has
 * no permission for arrives without it and says so — nobody ever gets a card
 * that renders "you can't see this".
 */
export const LAYOUT_PRESETS: readonly LayoutPreset[] = [
  {
    id: 'focus',
    name: 'My day',
    blurb: 'Just your own work: what is assigned, what is due, what you last touched.',
    instances: [
      { type: 'my-work', size: 'm' },
      { type: 'my-deadlines', size: 'm' },
      { type: 'last-worked-on', size: 'm' },
      { type: 'my-performance', size: 'm', config: { period: '30' } },
    ],
  },
  {
    id: 'lead',
    name: 'Running a team',
    blurb: 'What is waiting on you, what is stuck, and who is working right now.',
    instances: [
      { type: 'pending-time-approvals', size: 'l' },
      { type: 'blocked-exceptions', size: 'l' },
      { type: 'live-now', size: 's' },
      { type: 'my-work', size: 'm' },
      { type: 'pipeline-overview', size: 'l', config: { period: 'week' } },
    ],
  },
  {
    id: 'owner',
    name: 'Company overview',
    blurb: 'Numbers first: throughput, where projects land, and what moved today.',
    instances: [
      { type: 'facts', size: 'l' },
      { type: 'pipeline-overview', size: 'l', config: { period: 'month' } },
      { type: 'projection-strip', size: 'l' },
      { type: 'active-projects', size: 'l' },
      { type: 'recent-activity', size: 'm', config: { limit: '10' } },
    ],
  },
];

/** A preset, validated and permission-filtered exactly like a pasted code. */
export function buildPreset(
  preset: LayoutPreset,
  can: (permission: string | null) => boolean,
): LayoutBuild {
  return buildLayout(preset.instances, can);
}

// ── Copy for the UI ──────────────────────────────────────────────────────

/**
 * "Adds 7 widgets. 2 skipped — you don't have access." One sentence per reason,
 * so the preview never lumps "you can't see it" together with "it doesn't
 * exist here". Lives beside the rules it describes rather than in the popup.
 */
export function describeBuild(build: LayoutBuild): string {
  const n = build.instances.length;
  const lines = [`Adds ${n} ${n === 1 ? 'widget' : 'widgets'}, replacing what is on your dashboard now.`];
  const count = (reason: SkipReason) => build.skipped.filter(s => s.reason === reason).length;

  const denied = count('permission');
  const unknown = count('unknown');
  const duplicate = count('duplicate');
  const overCap = count('over-cap');

  if (denied > 0) lines.push(`${denied} skipped — you don't have access to ${denied === 1 ? 'it' : 'them'}.`);
  if (unknown > 0) lines.push(`${unknown} skipped — not in this version of TrustFlow.`);
  if (duplicate > 0) lines.push(`${duplicate} skipped — only one of that widget is allowed.`);
  if (overCap > 0) lines.push(`${overCap} skipped — a code can hold at most ${MAX_CODE_INSTANCES} widgets.`);

  return lines.join(' ');
}

// ponytail: no short-code service and no server table — a code IS the layout,
// so it needs no database and works offline. It is long (~120 chars for a full
// dashboard) as the price. Add a shortener only if people start sharing these
// somewhere with a length limit.
// ponytail: no per-user saved presets. The three built-ins plus "copy your own
// layout as a code" covers the same ground with nothing to store.
