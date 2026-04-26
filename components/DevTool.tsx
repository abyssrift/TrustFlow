import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useAlert } from '@/contexts/AlertContext';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link } from 'expo-router';

export default function DevTool() {
  const { showAlert } = useAlert();
  const [loading, setLoading] = useState(false);
  const [pipeline, setPipeline] = useState<any>(null);

  useEffect(() => {
    supabase.from('pipelines').select('*').eq('is_default', true).limit(1).single()
      .then(({data}) => setPipeline(data));
  }, []);

  const clearTasks = async () => {
    setLoading(true);
    const { error } = await supabase.from('tasks').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    setLoading(false);
    if (error) showAlert('Error', error.message);
    else showAlert('Success', 'Cleared tasks!');
  };

  const seedTasks = async () => {
    setLoading(true);
    for (let i = 0; i < 5; i++) {
      await supabase.rpc('rpc_create_task', {
        p_title: `Dev Task ${Math.floor(Math.random() * 1000)}`,
        p_description: 'Auto-seeded for quick testing',
        p_priority: 'medium',
        p_pipeline_id: pipeline?.id
      });
    }
    setLoading(false);
    showAlert('Success', 'Seeded 5 tasks!');
  };

  if (!process.env.EXPO_PUBLIC_SUPABASE_URL) return null;

  return (
    <View className="bg-surface-card p-4 rounded-xl border border-brand-primary/50 mb-6 border-dashed">
      <View className="flex-row items-center mb-4">
        <FontAwesome name="code" size={16} color="#6366f1" />
        <Text className="text-typography-main font-bold ml-2">Dev Tools</Text>
      </View>
      <View className="flex-row space-x-3">
        <TouchableOpacity 
          className="bg-brand-primary px-3 py-2 rounded-lg flex-1 items-center opacity-80"
          onPress={seedTasks}
          disabled={loading}
        >
          <Text className="text-white text-xs font-bold">Seed 5 Tasks</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          className="bg-red-500/20 px-3 py-2 rounded-lg flex-1 items-center border border-red-500/50"
          onPress={clearTasks}
          disabled={loading}
        >
          <Text className="text-red-400 text-xs font-bold">Clear Tasks</Text>
        </TouchableOpacity>
      </View>
      <Link href="/admin/pipelines" asChild>
        <TouchableOpacity className="mt-3 bg-brand-primary/10 border border-brand-primary/30 py-2 rounded-lg items-center">
          <Text className="text-brand-primary font-bold text-xs">Manage Pipelines & Stage Rules</Text>
        </TouchableOpacity>
      </Link>
      <Link href="/admin/reports" asChild>
        <TouchableOpacity className="mt-2 bg-brand-primary/10 border border-brand-primary/30 py-2 rounded-lg items-center">
          <Text className="text-brand-primary font-bold text-xs">View Organizational Audits & PDF Stats</Text>
        </TouchableOpacity>
      </Link>
    </View>
  );
}
