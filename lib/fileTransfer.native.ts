import * as DocumentPicker from 'expo-document-picker';

/**
 * Native file transfer (expo SDK 55 File/Paths API). Exported spreadsheets are
 * written into the app's document directory; the saved path is returned so the
 * caller can surface it. Import reads the picked file's bytes directly.
 */

export type PickedFile = { name: string; bytes: Uint8Array };

export async function saveBytes(
  filename: string,
  bytes: Uint8Array,
  _mime: string
): Promise<string | null> {
  try {
    const { File, Paths } = (await import('expo-file-system')) as any;
    const file = new File(Paths.document, filename);
    if (file.exists) file.delete();
    file.create();
    file.write(bytes);
    return file.uri as string;
  } catch (e) {
    console.error('[fileTransfer] native saveBytes failed', e);
    return null;
  }
}

export async function pickSpreadsheet(): Promise<PickedFile | null> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        'text/csv',
        'text/comma-separated-values',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '*/*',
      ],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets?.length) return null;
    const asset = result.assets[0];

    const { File } = (await import('expo-file-system')) as any;
    const file = new File(asset.uri);
    const bytes: Uint8Array = await file.bytes();
    return { name: asset.name || 'import', bytes };
  } catch (e) {
    console.error('[fileTransfer] native pickSpreadsheet failed', e);
    return null;
  }
}
