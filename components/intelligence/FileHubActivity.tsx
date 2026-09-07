import { FileActivity } from "@/contexts/FileHubContext";
import { formatRelative } from "@/lib/time";
import { useThemeColors } from "@/hooks/useThemeColors";
import { FontAwesome } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Text, View } from "react-native";
import UserLink from "../common/UserLink";
import { ACTIVITY_META } from "./filehubShared";

export function FileActivityRows({
  activity,
  loading = false,
  mobile = false,
}: {
  activity: FileActivity[] | null;
  loading?: boolean;
  mobile?: boolean;
}) {
  const colors = useThemeColors();
  if (loading || activity === null)
    return (
      <View className="py-10 items-center">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  if (activity.length === 0)
    return (
      <View className="py-10 items-center px-8">
        <FontAwesome
          name="clock-o"
          size={mobile ? 28 : 24}
          color={colors.textDim}
        />
        <Text className="text-typography-muted text-sm mt-3 text-center">
          No activity recorded yet
        </Text>
      </View>
    );
  return (
    <View>
      {activity.map((entry, i) => {
        const meta = ACTIVITY_META[entry.action] ?? {
          icon: "circle",
          color: colors.textMuted,
          label: entry.action,
        };
        return (
          <View
            key={entry.id}
            className={`flex-row items-start ${mobile ? "px-6 py-3.5" : "px-3 py-3"} ${i < activity.length - 1 ? "border-b border-surface-border/40" : ""}`}
          >
            <View
              className={`${mobile ? "w-8 h-8" : "w-7 h-7"} rounded-full items-center justify-center mr-3 flex-shrink-0 mt-0.5`}
              style={{ backgroundColor: meta.color + "20" }}
            >
              <FontAwesome
                name={meta.icon as any}
                size={mobile ? 12 : 11}
                color={meta.color}
              />
            </View>
            <View className="flex-1 min-w-0">
              <Text
                className={`${mobile ? "text-sm" : "text-xs"} text-typography-main font-bold`}
              >
                <UserLink
                  userId={entry.user.id}
                  name={entry.user.full_name}
                  tab="activity"
                  className={`${mobile ? "text-sm" : "text-xs"} text-typography-main font-bold`}
                />{" "}
                <Text className="text-typography-muted font-medium">
                  {meta.label.toLowerCase()}
                </Text>
              </Text>
              <Text
                className={`${mobile ? "text-xs" : "text-[10px]"} text-typography-dim mt-0.5`}
              >
                {formatRelative(entry.created_at)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}
