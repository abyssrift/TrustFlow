import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { useAlert } from '@/contexts/AlertContext';
import { supabase } from '@/lib/supabase';

export type ProjectFolderProject = {
  id: string;
  name: string;
  description: string;
  expiry_date: string | null;
  status: 'active' | 'closed' | 'archived';
};

export const PROJECT_STATUS_OPTIONS: { value: 'active' | 'closed' | 'archived'; label: string; icon: string }[] = [
  { value: 'active', label: 'Active', icon: 'play-circle' },
  { value: 'closed', label: 'Closed', icon: 'check-circle' },
];

export function useProjectFolderForm({
  visible,
  project,
  onSuccess,
  onClose,
}: {
  visible: boolean;
  project?: ProjectFolderProject;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const { showAlert } = useAlert();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [expiryDate, setExpiryDate] = useState<string | null>(null);
  const [status, setStatus] = useState<'active' | 'closed' | 'archived'>('active');
  const [loading, setLoading] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);

  useEffect(() => {
    if (project) {
      setName(project.name);
      setDescription(project.description || '');
      setExpiryDate(project.expiry_date ? new Date(project.expiry_date).toISOString().split('T')[0] : null);
      setStatus(project.status || 'active');
    } else {
      setName('');
      setDescription('');
      setExpiryDate(null);
      setStatus('active');
    }
    setShowCalendar(false);
  }, [project, visible]);

  const handleSave = async () => {
    if (!name.trim()) {
      showAlert('Error', 'Project name is required');
      return;
    }

    try {
      setLoading(true);
      const projectData = {
        name: name.trim(),
        description: description.trim(),
        expiry_date: expiryDate ? new Date(expiryDate).toISOString() : null,
        status: status,
        updated_at: new Date().toISOString(),
      };

      let error;
      if (project) {
        ({ error } = await supabase
          .from('projects')
          .update(projectData)
          .eq('id', project.id));
      } else {
        const { data, error: rpcError } = await supabase.rpc('rpc_create_project', {
          p_name: projectData.name,
          p_description: projectData.description,
          p_expiry_date: projectData.expiry_date,
          p_status: projectData.status,
        });
        error = rpcError;
      }

      if (error) throw error;
      showAlert('Success', `Project ${project ? 'updated' : 'created'} successfully`);
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error saving project:', err);
      showAlert('Error', err.message || 'Failed to save project');
    } finally {
      setLoading(false);
    }
  };

  const handleArchiveProject = async () => {
    if (!project) return;

    try {
      const lastArchived = await AsyncStorage.getItem('last_archival_at');
      const now = Date.now();
      if (lastArchived && now - parseInt(lastArchived) < 35000) {
        const remaining = Math.ceil((35000 - (now - parseInt(lastArchived))) / 1000);
        showAlert('Sync Cooldown', `Network synchronization in progress. Please wait ${remaining}s for cross-platform safety.`);
        return;
      }

      setLoading(true);
      const { error } = await supabase.rpc('rpc_archive_project', { p_project_id: project.id });
      if (error) throw error;

      await AsyncStorage.setItem('last_archival_at', now.toString());
      showAlert('Success', 'Project and all associated tasks have been snapshotted to Cold Storage.');
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error archiving project:', err);
      showAlert('Archival Error', err.message || 'Failed to archive project');
    } finally {
      setLoading(false);
      setShowArchiveConfirm(false);
    }
  };

  return {
    name, setName,
    description, setDescription,
    expiryDate, setExpiryDate,
    status, setStatus,
    loading,
    showArchiveConfirm, setShowArchiveConfirm,
    showCalendar, setShowCalendar,
    handleSave, handleArchiveProject,
  };
}
