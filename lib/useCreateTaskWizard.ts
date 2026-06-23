import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';

import { useTaskCreation } from '@/contexts/TaskCreationContext';
import { supabase } from '@/lib/supabase';

export type TaskTemplate = {
  name: string;
  title: string;
  description: string;
  category: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  weight: number;
};

const TEMPLATES_KEY = '@TrustFlow_task_templates';

export function useCreateTaskWizard({ visible, initialPipelineId }: { visible: boolean; initialPipelineId?: string | null }) {
  const { draft, setDraft, createTask, createBulkTasks, loading, recentTasks, loadRecentTasks, briefFiles, setBriefFiles } = useTaskCreation();
  const [step, setStep] = useState(1);
  // Bulk quick-add: one task title per line, sharing all other draft fields.
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const bulkTitles = useMemo(
    () => bulkText.split('\n').map(t => t.trim()).filter(Boolean),
    [bulkText]
  );
  const canSubmit = bulkMode ? bulkTitles.length > 0 : !!draft.title;
  const [users, setUsers] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [showCalendar, setShowCalendar] = useState(false);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);

  const loadTemplates = async () => {
    try {
      const saved = await AsyncStorage.getItem(TEMPLATES_KEY);
      if (saved) setTemplates(JSON.parse(saved));
    } catch {}
  };

  const saveAsTemplate = async () => {
    if (!draft.title.trim()) {
      Alert.alert('No Title', 'Add a title first to save it as a template.');
      return;
    }
    const template: TaskTemplate = {
      name: draft.title.trim(),
      title: draft.title,
      description: draft.description,
      category: draft.category,
      priority: draft.priority,
      weight: draft.weight,
    };
    const updated = [...templates, template];
    setTemplates(updated);
    await AsyncStorage.setItem(TEMPLATES_KEY, JSON.stringify(updated));
  };

  const loadTemplate = (template: TaskTemplate) => {
    setDraft({
      title: template.title,
      description: template.description,
      category: template.category,
      priority: template.priority,
      weight: template.weight,
    });
  };

  const deleteTemplate = async (index: number) => {
    const updated = templates.filter((_, i) => i !== index);
    setTemplates(updated);
    await AsyncStorage.setItem(TEMPLATES_KEY, JSON.stringify(updated));
  };

  const fetchResources = async () => {
    const [{ data: userData }, { data: teamData }] = await Promise.all([
      supabase.from('users').select('id, full_name').is('deleted_at', null),
      supabase.from('teams').select('id, name, color').is('deleted_at', null),
    ]);
    setUsers(userData || []);
    setTeams(teamData || []);
  };

  useEffect(() => {
    if (visible) {
      loadRecentTasks();
      loadTemplates();
      fetchResources();
      if (initialPipelineId && !draft.pipelineId) {
        setDraft({ pipelineId: initialPipelineId });
      }
    } else {
      setStep(1);
      setBulkMode(false);
      setBulkText('');
    }
  }, [visible]);

  const handleCreate = async (onClose: () => void) => {
    if (bulkMode) {
      const n = await createBulkTasks(bulkTitles);
      if (n > 0) { setBulkText(''); onClose(); }
      return;
    }
    const id = await createTask();
    if (id) onClose();
  };

  const removeBriefFile = (id: string) => {
    setBriefFiles(prev => prev.filter(x => x.id !== id));
  };

  return {
    draft, setDraft, loading, recentTasks, briefFiles, setBriefFiles,
    step, setStep,
    bulkMode, setBulkMode,
    bulkText, setBulkText,
    bulkTitles, canSubmit,
    users, teams,
    showCalendar, setShowCalendar,
    templates, saveAsTemplate, loadTemplate, deleteTemplate,
    handleCreate, removeBriefFile,
  };
}
