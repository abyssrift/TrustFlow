import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabaseUrl } from '@/lib/supabase';

// Renders nothing when pointed at prod — this must never show up for real users.
const isLocalBackend = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(supabaseUrl);

export default function LocalEnvBadge() {
  const insets = useSafeAreaInsets();

  if (!isLocalBackend) return null;

  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: insets.top + 6, right: 8, zIndex: 9999 }}
      className="bg-state-warning/90 rounded-full px-2 py-[3px]"
    >
      <Text className="text-white text-[9px] font-black uppercase tracking-wider">Local</Text>
    </View>
  );
}
