import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import * as ImageManipulator from 'expo-image-manipulator';
import React, { createContext, useCallback, useContext, useState } from 'react';
import { Alert } from 'react-native';

export type UploadJob = {
  taskId: string;
  taskTitle: string;
  status: 'processing' | 'uploading' | 'committing' | 'completed' | 'error';
  progress: number;
  currentAction: string;
  error?: string;
  totalFiles: number;
  completedFiles: number;
};

type SubmissionContextType = {
  activeJobs: Record<string, UploadJob>;
  submitWithEvidence: (params: {
    taskId: string;
    taskTitle: string;
    companyId: string;
    content: string;
    transitionId?: string | null;
    stagedFiles: any[];
  }) => Promise<void>;
  clearJob: (taskId: string) => void;
};

const MIME_CATEGORIES: Record<string, string> = {
  'image': 'image',
  'pdf': 'document',
  'ms-excel': 'spreadsheet',
  'spreadsheetml': 'spreadsheet',
  'officedocument.spreadsheetml': 'spreadsheet',
  'text/csv': 'spreadsheet',
  'wordprocessingml': 'document',
  'text/plain': 'document'
};

const getFileCategory = (mimeType: string): string => {
  const type = mimeType.toLowerCase();
  for (const key in MIME_CATEGORIES) {
    if (type.includes(key)) return MIME_CATEGORIES[key];
  }
  return 'other';
};

const SubmissionContext = createContext<SubmissionContextType | undefined>(undefined);

export function SubmissionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [activeJobs, setActiveJobs] = useState<Record<string, UploadJob>>({});

  const updateJob = useCallback((taskId: string, updates: Partial<UploadJob>) => {
    setActiveJobs(prev => {
      if (!prev[taskId]) return prev;
      return {
        ...prev,
        [taskId]: { ...prev[taskId], ...updates }
      };
    });
  }, []);

  const clearJob = useCallback((taskId: string) => {
    setActiveJobs(prev => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
  }, []);

  const submitWithEvidence = async ({
    taskId,
    taskTitle,
    companyId,
    content,
    transitionId,
    stagedFiles
  }: {
    taskId: string;
    taskTitle: string;
    companyId: string;
    content: string;
    transitionId?: string | null;
    stagedFiles: any[];
  }) => {
    if (!user) throw new Error('Auth required');

    // Initialize job
    const initialJob: UploadJob = {
      taskId,
      taskTitle,
      status: 'processing',
      progress: 0,
      currentAction: 'Preparing evidence...',
      totalFiles: stagedFiles.length,
      completedFiles: 0
    };
    setActiveJobs(prev => ({ ...prev, [taskId]: initialJob }));

    try {
      const uploadedAttachments: any[] = [];
      let completedCount = 0;

      const processAndUploadFile = async (file: any) => {
        let finalUri = file.uri;
        const category = getFileCategory(file.type || '');
        
        // 1. Optimize Images
        if (category === 'image') {
          try {
            const result = await ImageManipulator.manipulateAsync(
              file.uri,
              [{ resize: { width: 2000 } }],
              { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
            );
            finalUri = result.uri;
          } catch (e) {
            console.warn('Optimization failed', e);
          }
        }

        // 2. Convert URI to Blob (Crucial for Web compatibility)
        const response = await fetch(finalUri);
        const blob = await response.blob();

        // 3. Upload to Storage
        const fileExt = file.name.split('.').pop() || 'bin';
        const filePath = `${companyId}/tasks/${taskId}/users/${user.id}/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;

        const { data, error: storageError } = await supabase.storage
          .from('submission-attachments')
          .upload(filePath, blob, {
            contentType: file.type || 'application/octet-stream',
            upsert: true
          });

        if (storageError) throw storageError;

        completedCount++;
        const currentProgress = Math.min(90, (completedCount / stagedFiles.length) * 100);

        updateJob(taskId, {
          completedFiles: completedCount,
          progress: currentProgress,
          currentAction: `Uploaded ${completedCount}/${stagedFiles.length}...`
        });

        return {
          file_name: file.name,
          file_url: data.path,
          storage_path: data.path,
          file_size: file.size,
          mime_type: file.type,
          category: category
        };
      };

      // Parallel Upload with Concurrency Limit 3
      if (stagedFiles.length > 0) {
        const queue = [...stagedFiles];
        const workers = Array(Math.min(3, queue.length)).fill(null).map(async () => {
          while (queue.length > 0) {
            const file = queue.shift();
            if (file) {
              const result = await processAndUploadFile(file);
              uploadedAttachments.push(result);
            }
          }
        });
        await Promise.all(workers);
      }

      // 4. Commit to Database
      updateJob(taskId, { 
        currentAction: 'Finalizing audit trail...', 
        status: 'committing', 
        progress: 95 
      });

      const { error: rpcError } = await supabase.rpc('rpc_submit_work', {
        p_task_id: taskId,
        p_content: content,
        p_transition_id: transitionId || null,
        p_attachments: uploadedAttachments
      });

      if (rpcError) throw rpcError;

      updateJob(taskId, { 
        status: 'completed', 
        progress: 100, 
        currentAction: 'Submission successful!' 
      });
      
      // Auto-clear after 4 seconds for better user visibility
      setTimeout(() => clearJob(taskId), 4000);

    } catch (err: any) {
      console.error('Submission Engine Error:', err);

      // Timer gate errors must surface to the caller so the manual-time modal
      // can be shown. Don't alert and don't swallow.
      if (err.message?.includes('LOW_TIMER_TIME') || err.message?.includes('TIME_APPROVAL_PENDING')) {
        updateJob(taskId, {
          status: 'error',
          error: err.message,
          currentAction: 'Time declaration required',
        });
        throw err;
      }

      let displayMessage = err.message;
      if (err.code === 'P0001' && err.message?.includes('Mandatory evidence missing')) {
        displayMessage = 'This stage requires a submission with text or attachments to proceed.';
      }

      updateJob(taskId, {
        status: 'error',
        error: displayMessage,
        currentAction: 'Failed to submit evidence'
      });
      Alert.alert('Submission Failed', `Task: ${taskTitle}\nError: ${displayMessage}`);
    }
  };

  return (
    <SubmissionContext.Provider value={{ activeJobs, submitWithEvidence, clearJob }}>
      {children}
    </SubmissionContext.Provider>
  );
}

export function useSubmission() {
  const context = useContext(SubmissionContext);
  if (!context) throw new Error('useSubmission must be used within a SubmissionProvider');
  return context;
}
