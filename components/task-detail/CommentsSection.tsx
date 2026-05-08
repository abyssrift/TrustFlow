import React, { useState, useMemo, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, FlatList } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useTaskDetail, CommentData } from '@/contexts/TaskDetailContext';
import { useTimer } from '@/contexts/TimerContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import PermissionGate from './PermissionGate';

type CommentTree = CommentData & { children: CommentTree[] };

function buildTree(comments: CommentData[]): CommentTree[] {
  const map = new Map<string, CommentTree>();
  const roots: CommentTree[] = [];

  comments.forEach(c => map.set(c.id, { ...c, children: [] }));

  comments.forEach(c => {
    const node = map.get(c.id)!;
    if (c.parent_id && map.has(c.parent_id)) {
      map.get(c.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function CommentNode({ comment, depth, onReply, onDelete, canComment, currentUserId, checkIfMentioned }: {
  comment: CommentTree; depth: number; onReply: (id: string) => void;
  onDelete: (id: string) => void; canComment: boolean; currentUserId: string | null;
  checkIfMentioned: (content: string) => boolean;
}) {
  const isMentioned = checkIfMentioned(comment.content);
  const maxIndent = Math.min(depth, 6); // Cap visual indent at 6 levels

  return (
    <View style={{ marginLeft: maxIndent * 16 }} className="mb-3">
      <View className={`
        ${comment.is_system ? 'bg-surface-background' : 'bg-surface-card'} 
        rounded-xl border p-3
        ${isMentioned ? 'border-brand-primary bg-brand-primary/5 shadow-sm' : 'border-surface-border/50'}
      `}>
        {/* Author row */}
        <View className="flex-row items-center justify-between mb-1.5">
          <View className="flex-row items-center">
            <View className="w-5 h-5 rounded-full bg-brand-primary/20 items-center justify-center mr-2">
              <Text className="text-brand-primary text-[8px] font-black">
                {(comment.author?.full_name || '?').charAt(0)}
              </Text>
            </View>
            <Text className="text-typography-main text-xs font-bold">
              {comment.is_system ? 'System' : comment.author?.full_name || 'Unknown'}
            </Text>
            <Text className="text-typography-dim text-[9px] ml-2">{timeAgo(comment.created_at)}</Text>
            {isMentioned && (
              <View className="ml-2 bg-brand-primary/20 px-1.5 py-0.5 rounded-full">
                <Text className="text-brand-primary text-[8px] font-black uppercase">Mentioned</Text>
              </View>
            )}
          </View>

          {/* Delete button (only for own comments) */}
          {currentUserId === comment.author?.id && (
            <TouchableOpacity onPress={() => onDelete(comment.id)} className="p-1">
              <FontAwesome name="trash-o" size={10} color="#64748b" />
            </TouchableOpacity>
          )}
        </View>

        {/* Content */}
        <Text className={`${comment.is_system ? 'text-typography-dim italic' : 'text-typography-label'} text-sm leading-5`}>
          {comment.content}
        </Text>

        {/* Reply button */}
        {canComment && !comment.is_system && (
          <TouchableOpacity onPress={() => onReply(comment.id)} className="mt-1.5 flex-row items-center">
            <FontAwesome name="reply" size={9} color="#6366f1" />
            <Text className="text-brand-primary text-[9px] font-bold ml-1.5">Reply</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Recursively render children */}
      {comment.children.map(child => (
        <CommentNode
          key={child.id}
          comment={child}
          depth={depth + 1}
          onReply={onReply}
          onDelete={onDelete}
          canComment={canComment}
          currentUserId={currentUserId}
          checkIfMentioned={checkIfMentioned}
        />
      ))}
    </View>
  );
}

export default function CommentsSection() {
  const { data, addComment, deleteComment } = useTaskDetail();
  const { smartTimer } = useTimer();
  const { user, profile } = useAuth();
  
  // Calculate user variants for mention highlighting
  const userVariants = useMemo(() => {
    const variants = new Set<string>();
    const full = profile?.full_name || user?.user_metadata?.full_name;
    const disp = profile?.display_name;
    
    if (full) {
      variants.add(full.toLowerCase());
      const first = full.split(' ')[0];
      if (first && first.length > 2) variants.add(first.toLowerCase());
    }
    if (disp) variants.add(disp.toLowerCase());
    
    return Array.from(variants);
  }, [profile, user]);

  const checkIfMentioned = (content: string) => {
    if (!content || userVariants.length === 0) return false;
    const lowerContent = content.toLowerCase();
    return userVariants.some(v => lowerContent.includes(`@${v}`));
  };
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Mention system state
  const [eligibleUsers, setEligibleUsers] = useState<any[]>([]);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const [lastAck, setLastAck] = useState<string | null>(null);

  // Fetch last acknowledgement time
  useEffect(() => {
    const fetchLastAck = async () => {
      if (!data?.task?.id || !user?.id) return;
      const { data: ack } = await supabase
        .from('task_mention_acks')
        .select('acknowledged_at')
        .eq('task_id', data.task.id)
        .eq('user_id', user.id)
        .single();
      if (ack) setLastAck(ack.acknowledged_at);
    };
    fetchLastAck();
  }, [data?.task?.id, user?.id]);

  // Mark mentions as read when viewed
  useEffect(() => {
    const hasMentions = data?.comments?.some(c => checkIfMentioned(c.content));
    const hasNewMention = data?.comments?.some(c => {
      const isMentioned = checkIfMentioned(c.content);
      return isMentioned && (!lastAck || new Date(c.created_at) > new Date(lastAck));
    });

    if (hasNewMention && user?.id && profile?.company_id && data?.task?.id) {
       // Upsert current time as acknowledged_at
       supabase
         .from('task_mention_acks')
         .upsert({
           task_id: data.task.id,
           user_id: user.id,
           company_id: profile.company_id,
           acknowledged_at: new Date().toISOString()
         }, { onConflict: 'task_id,user_id' })
         .then(({ error }) => {
           if (!error) {
             setLastAck(new Date().toISOString());
           }
         });
    }
  }, [data?.comments, user?.id, profile?.company_id, data?.task?.id, lastAck]);

  useEffect(() => {
    const fetchEligibleUsers = async () => {
      if (!data?.task?.company_id) return;
      
      // Fetch all active users in the company
      const { data: users, error } = await supabase
        .from('users')
        .select('id, full_name, display_name, avatar_url')
        .eq('company_id', data.task.company_id)
        .eq('is_active', true);
      
      if (!error && users) {
        setEligibleUsers(users);
      }
    };
    fetchEligibleUsers();
  }, [data?.task?.company_id]);

  const filteredUsers = useMemo(() => {
    if (!mentionQuery) return eligibleUsers;
    const q = mentionQuery.toLowerCase();
    return eligibleUsers.filter(u => 
      (u.full_name || '').toLowerCase().includes(q) || 
      (u.display_name || '').toLowerCase().includes(q)
    );
  }, [eligibleUsers, mentionQuery]);

  const updateMentionState = (text: string, position: number) => {
    // Detect mention trigger
    // We look for '@' at the current cursor or before it
    const lastAtIdx = text.lastIndexOf('@', position - 1);
    const charBeforeAt = lastAtIdx > 0 ? text[lastAtIdx - 1] : null;
    const isValidTrigger = lastAtIdx !== -1 && (!charBeforeAt || charBeforeAt === ' ' || charBeforeAt === '\n');

    if (isValidTrigger) {
      const chunk = text.slice(lastAtIdx + 1, position);
      if (!chunk.includes('\n') && !chunk.includes('  ')) { // Don't show if too many spaces
        setMentionQuery(chunk);
        setShowMentionPicker(true);
      } else {
        setShowMentionPicker(false);
      }
    } else {
      setShowMentionPicker(false);
    }
  };

  const handleInputChange = (text: string) => {
    setInput(text);
    updateMentionState(text, cursorPos);
  };

  const handleSelectionChange = (position: number) => {
    setCursorPos(position);
    updateMentionState(input, position);
  };

  const handleSelectUser = (user: any) => {
    const lastAtIdx = input.lastIndexOf('@', cursorPos - 1);
    if (lastAtIdx === -1) return;

    const nameToInsert = user.display_name || user.full_name || 'User';
    const beforeAt = input.slice(0, lastAtIdx);
    const afterAt = input.slice(cursorPos);
    
    const newValue = `${beforeAt}@${nameToInsert} ${afterAt}`;
    setInput(newValue);
    setShowMentionPicker(false);
  };

  const tree = useMemo(() => buildTree(data?.comments || []), [data?.comments]);

  if (!data) return null;

  const replyComment = replyTo ? data.comments.find(c => c.id === replyTo) : null;

  const handleSend = async () => {
    if (!input.trim()) return;
    try {
      setSending(true);
      await addComment(input.trim(), replyTo);
      setInput('');
      setReplyTo(null);
    } catch (err: any) {
      Alert.alert('Comment Error', err.message);
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    Alert.alert('Delete Comment', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteComment(commentId) },
    ]);
  };

  return (
    <View className="bg-surface-card rounded-2xl border border-surface-border p-4">
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.15em]">
          Comments ({data.comments.length})
        </Text>
        {data.comments.some(c => checkIfMentioned(c.content)) && (
          <View className="flex-row items-center">
            <FontAwesome name="check-circle" size={10} color="#10b981" />
            <Text className="text-state-success text-[9px] font-bold ml-1 uppercase">Mentions Cleared</Text>
          </View>
        )}
      </View>

      {/* Comment tree */}
      {tree.length === 0 ? (
        <View className="py-4 items-center opacity-40">
          <FontAwesome name="comments-o" size={20} color="#64748b" />
          <Text className="text-typography-muted text-xs mt-2">No comments yet. Start the conversation!</Text>
        </View>
      ) : (
        tree.map(c => (
          <CommentNode
            key={c.id}
            comment={c}
            depth={0}
            onReply={setReplyTo}
            onDelete={handleDelete}
            canComment={data.permissions.can_comment}
            currentUserId={user?.id || null}
            checkIfMentioned={checkIfMentioned}
          />
        ))
      )}

      {/* Compose bar */}
      <PermissionGate allowed={data.permissions.can_comment}>
        <View className="mt-3 pt-3 border-t border-surface-border/30">
          {/* Reply indicator */}
          {replyComment && (
            <View className="flex-row items-center bg-surface-background rounded-lg px-3 py-2 mb-2 border border-surface-border/50">
              <FontAwesome name="reply" size={9} color="var(--color-primary)" />
              <Text className="text-typography-muted text-[10px] ml-2 flex-1" numberOfLines={1}>
                Replying to {replyComment.author?.full_name}: {replyComment.content}
              </Text>
              <TouchableOpacity onPress={() => setReplyTo(null)}>
                <FontAwesome name="times" size={10} color="var(--color-text-muted)" />
              </TouchableOpacity>
            </View>
          )}

          {/* Mention Picker */}
          {showMentionPicker && filteredUsers.length > 0 && (
            <View className="bg-surface-background border border-surface-border rounded-xl mb-2 overflow-hidden max-h-[160px]">
              <FlatList
                data={filteredUsers}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="always"
                renderItem={({ item }) => (
                  <TouchableOpacity 
                    onPress={() => handleSelectUser(item)}
                    className="flex-row items-center p-3 border-b border-surface-border/30 active:bg-brand-primary/10"
                  >
                    <View className="w-6 h-6 rounded-full bg-brand-primary/20 items-center justify-center mr-3">
                      <Text className="text-brand-primary text-[10px] font-black">
                        {(item.full_name || '?').charAt(0)}
                      </Text>
                    </View>
                    <View>
                      <Text className="text-typography-main text-xs font-bold">{item.full_name}</Text>
                      {item.display_name && (
                        <Text className="text-typography-dim text-[9px]">@{item.display_name}</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                )}
              />
            </View>
          )}

          <View className="flex-row items-end gap-2">
            <TextInput
              value={input}
              onChangeText={handleInputChange}
              onSelectionChange={(e) => handleSelectionChange(e.nativeEvent.selection.start)}
              placeholder={replyTo ? 'Write a reply...' : 'Write a comment...'}
              placeholderTextColor="var(--color-text-muted)"
              multiline
              className="flex-1 bg-surface-background border border-surface-border rounded-xl px-3 py-2.5 text-typography-main text-sm max-h-[100px]"
            />
            <TouchableOpacity
              onPress={handleSend}
              disabled={sending || !input.trim()}
              className={`bg-brand-primary p-2.5 rounded-xl ${(!input.trim() || sending) ? 'opacity-50' : ''}`}
            >
              {sending ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <FontAwesome name="paper-plane" size={14} color="white" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </PermissionGate>
    </View>
  );
}
