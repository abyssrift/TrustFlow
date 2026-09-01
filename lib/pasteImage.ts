import * as Clipboard from 'expo-clipboard';

export type PastedFile = {
  id: string;
  uri: string;
  name: string;
  size: number;
  type: string;
};

/**
 * Reads an image from the clipboard and returns it in the same shape the
 * brief/submission upload pipelines expect. The `data` URI rides the existing
 * `fetch(uri) -> blob` upload path unchanged. Returns null if the clipboard
 * holds no image (or permission was denied).
 */
/**
 * Maps a dropped/selected web File into the same shape the brief/submission/
 * task-creation upload pipelines expect. An object URL rides the existing
 * `fetch(uri) -> blob` path unchanged. Web only (File is a browser type).
 */
export function fileToStaged(file: File): PastedFile {
  return {
    id: Math.random().toString(36).substring(7),
    uri: URL.createObjectURL(file),
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
  };
}

/**
 * Phase 3: seed an opening Create-Task composer from a screen-level paste/drop.
 * `initialText`'s first line becomes the title (only while the title is still
 * empty); any remainder is appended to the description. `initialFiles` are
 * appended to the staged brief files. Lives here so CreateTaskModal.web.tsx and
 * CreateTaskModal.tsx keep identical logic instead of duplicating it.
 */
export function applyTaskSeed(
  seed: { initialText?: string | null; initialFiles?: PastedFile[] | null },
  current: { title: string; description: string },
  setDraft: (updates: { title?: string; description?: string }) => void,
  addBriefFiles: (files: PastedFile[]) => void,
): void {
  const text = seed.initialText;
  if (text) {
    const nl = text.indexOf('\n');
    const firstLine = nl === -1 ? text : text.slice(0, nl);
    const rest = nl === -1 ? '' : text.slice(nl + 1);
    if (!current.title) setDraft({ title: firstLine });
    if (rest) setDraft({ description: current.description ? current.description + '\n' + rest : rest });
  }
  if (seed.initialFiles && seed.initialFiles.length) addBriefFiles(seed.initialFiles);
}

export async function getPastedImageFile(): Promise<PastedFile | null> {
  if (!(await Clipboard.hasImageAsync())) return null;
  const img = await Clipboard.getImageAsync({ format: 'png' });
  if (!img?.data) return null;
  return {
    id: Math.random().toString(36).substring(7),
    uri: img.data,
    name: `pasted_${Date.now()}.png`,
    size: 0, // clipboard reports dimensions, not byte size
    type: 'image/png',
  };
}
