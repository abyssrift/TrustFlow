import { Linking } from 'react-native';
import { supabase } from './supabase';

export const SUBMISSION_BUCKET = 'submission-attachments';
export const TASK_BRIEF_BUCKET = 'task-attachments';

/**
 * Opens a storage file. Uses signed URLs for private buckets.
 * Falls back to direct URL open for legacy records that stored full http URLs.
 */
export async function openStorageFile(bucket: string, storagePath: string): Promise<void> {
  if (!storagePath) return;

  // Legacy records stored full public URLs — open directly (will 404 for private buckets,
  // but there's nothing we can do for those old records)
  if (storagePath.startsWith('http')) {
    await Linking.openURL(storagePath);
    return;
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, 3600);

  if (error || !data?.signedUrl) {
    console.error('[Storage] Failed to generate signed URL:', error);
    return;
  }

  await Linking.openURL(data.signedUrl);
}
