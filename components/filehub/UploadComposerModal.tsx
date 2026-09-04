// Native fallback for the #340 upload composer.
//
// The real composer (UploadComposerModal.web.tsx) routes through
// UploadManagerContext — its 4-worker background engine, dup/name-conflict
// island prompts, the topbar progress island. That provider is mounted only in
// app/_layout.web.tsx; native has no UploadManagerProvider and FileHub's native
// upload lives as an inline flow inside components/intelligence/_filehub_adaptive.tsx,
// coupled to that screen's state. Extracting it is out of scope for #340.
//
// ponytail: #340 follow-up — until the native FileHub upload flow is lifted out
// of _filehub_adaptive.tsx, summon('upload') on native just navigates to the
// FileHub screen (identical to the pre-#340 QuickCreateButton behaviour) and
// dismisses the modal. folderId/taskId are dropped here.
import { useEffect } from 'react';
import { useRouter } from 'expo-router';

export type UploadComposerModalProps = {
  visible: boolean;
  onClose: () => void;
  folderId?: string;
  taskId?: string;
};

export default function UploadComposerModal({ visible, onClose }: UploadComposerModalProps) {
  const router = useRouter();
  useEffect(() => {
    if (!visible) return;
    router.push('/filehub' as any);
    onClose();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
