import AsyncStorage from '@react-native-async-storage/async-storage';
import { toast } from '@/lib/toast';

// When Reduce Motion is on (OS accessibility setting, `prefers-reduced-motion`,
// or Windows' "best performance" preset, which broadcasts it), every animation
// in the app is deliberately suppressed — transitions just snap. Users who
// didn't set that themselves read the snap as broken UI, so the first time an
// animation is suppressed we say why, then stay quiet for a day.
//
// Call this only from *user-triggered* animations. Ambient loops
// (IdleConveyor, SLARiskPulse) and mount-driven ones (StageCountOdometer) would
// fire it on every render pass, i.e. spam on app load.
const KEY = '@TrustFlow_reduced_motion_notice_at';
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // ponytail: per-device, bump if once a day still reads as chatty

let lastShown = 0;
let loaded = false;
let pending = false;

export function noticeReducedMotion() {
  void maybeShow();
}

async function maybeShow() {
  if (pending || Date.now() - lastShown < COOLDOWN_MS) return;
  pending = true;
  try {
    if (!loaded) {
      loaded = true;
      try {
        lastShown = Number(await AsyncStorage.getItem(KEY)) || 0;
      } catch {}
      if (Date.now() - lastShown < COOLDOWN_MS) return;
    }
    lastShown = Date.now();
    AsyncStorage.setItem(KEY, String(lastShown)).catch(() => {});
    toast({
      type: 'info',
      title: 'Animations are turned off',
      message: "Your device has Reduce Motion (or a “best performance” display preset) enabled, so TrustFlow skips its transitions. Nothing is broken — turn that off in your system settings to see them.",
      duration: 6500,
    });
  } finally {
    pending = false;
  }
}
