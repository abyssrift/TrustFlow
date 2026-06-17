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
