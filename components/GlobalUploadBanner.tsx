import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSubmission } from '@/contexts/SubmissionContext';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function GlobalUploadBanner() {
  const { activeJobs, clearJob } = useSubmission();
  const insets = useSafeAreaInsets();

  const jobs = Object.values(activeJobs);
  if (jobs.length === 0) return null;

  return (
    <View 
      style={{ paddingTop: insets.top }}
      className="bg-brand-primary shadow-lg"
    >
      {jobs.map((job) => (
        <View key={job.taskId} className="px-4 py-3 border-b border-white/10">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center flex-1 mr-3">
              <View className="w-8 h-8 rounded-full bg-white/20 items-center justify-center mr-3">
                {job.status === 'completed' ? (
                  <FontAwesome name="check" size={14} color="#fff" />
                ) : job.status === 'error' ? (
                  <FontAwesome name="exclamation-triangle" size={14} color="#fff" />
                ) : (
                  <ActivityIndicator size="small" color="#fff" />
                )}
              </View>
              
              <View className="flex-1">
                <Text className="text-white text-[10px] font-black uppercase tracking-widest opacity-80" numberOfLines={1}>
                  {job.taskTitle}
                </Text>
                <Text className="text-white text-xs font-bold" numberOfLines={1}>
                  {job.currentAction}
                </Text>
              </View>
            </View>

            {/* Progress / Actions */}
            <View className="flex-row items-center">
              {job.status === 'error' || job.status === 'completed' ? (
                <TouchableOpacity 
                  onPress={() => clearJob(job.taskId)}
                  className="bg-white/20 p-2 rounded-full"
                >
                  <FontAwesome name="times" size={12} color="#fff" />
                </TouchableOpacity>
              ) : (
                <View className="bg-white/20 px-2 py-1 rounded-md">
                  <Text className="text-white text-[10px] font-black uppercase tracking-tighter">
                    {job.totalFiles > 1 ? `${job.completedFiles}/${job.totalFiles} • ` : ''}
                    {Math.round(job.progress)}%
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Progress Bar */}
          {job.status !== 'completed' && job.status !== 'error' && (
            <View className="h-1 bg-white/20 rounded-full mt-3 overflow-hidden">
              <View 
                className="h-full bg-white" 
                style={{ width: `${job.progress}%` }} 
              />
            </View>
          )}
        </View>
      ))}
    </View>
  );
}
