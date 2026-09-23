import { useAlert } from '@/contexts/AlertContext';
import { useAuth } from '@/contexts/AuthContext';
import Tooltip from '@/components/common/Tooltip';
import { CommentData, useTaskDetail } from '@/contexts/TaskDetailContext';
import { useTimer } from '@/contexts/TimerContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import { formatRelative } from '@/lib/time';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import CollapsibleCard from './CollapsibleCard';
import LinkifiedText from '../common/LinkifiedText';
import PermissionGate from './PermissionGate';
import UserLink from '../common/UserLink';

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
  return formatRelative(dateStr);
}

type NameMap = Map<string, string[]>;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// #461: highlight only the @Name tokens of users actually stored in
// mentioned_user_ids -- never a substring guess.
function CommentContent({ comment, names, colors }: {
  comment: CommentData; names: NameMap; colors: ReturnType<typeof useThemeColors>;
}) {
  const className = `${comment.is_system ? 'text-typography-dim italic' : 'text-typography-label'} text-sm leading-5`;
  const tokens = (comment.mentioned_user_ids || [])
    .flatMap(id => names.get(id) || [])
    .map(n => `@${n}`)
    .sort((a, b) => b.length - a.length);
  if (tokens.length === 0) return <LinkifiedText className={className}>{comment.content}</LinkifiedText>;

  const parts = comment.content.split(new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'g'));
  return (
    <Text className={className}>
      {parts.map((part, i) => !part ? null : tokens.includes(part) ? (
        <Text key={i} style={{ color: colors.primary, fontWeight: '700' }}>{part}</Text>
      ) : (
        <LinkifiedText key={i}>{part}</LinkifiedText>
      ))}
    </Text>
  );
}

function CommentNode({ comment, depth, onReply, onDelete, canComment, currentUserId, names, colors }: {
  comment: CommentTree; depth: number; onReply: (id: string) => void;
  onDelete: (id: string) => void; canComment: boolean; currentUserId: string | null;
  names: NameMap;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const isMentioned = !!currentUserId && !!comment.mentioned_user_ids?.includes(currentUserId);
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
            {comment.is_system ? (
              <Text className="text-typography-main text-xs font-bold">System</Text>
            ) : (
              <UserLink userId={comment.author?.id} name={comment.author?.full_name} fallback="Unknown" className="text-typography-main text-xs font-bold" />
            )}
            <Text className="text-typography-dim text-[9px] ml-2">{timeAgo(comment.created_at)}</Text>
            {isMentioned && (
              <View className="ml-2 bg-brand-primary/20 px-1.5 py-0.5 rounded-full">
                <Text className="text-brand-primary text-[8px] font-black uppercase">Mentioned</Text>
              </View>
            )}
          </View>

          {/* Delete button (only for own comments) */}
          {currentUserId === comment.author?.id && (
            <Tooltip label="Delete comment">
              <TouchableOpacity onPress={() => onDelete(comment.id)} className="p-1">
                <FontAwesome name="trash-o" size={10} color={colors.textMuted} />
              </TouchableOpacity>
            </Tooltip>
          )}
        </View>

        {/* Content */}
        <CommentContent comment={comment} names={names} colors={colors} />

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
          names={names}
          colors={colors}
        />
      ))}
    </View>
  );
}

export default function CommentsSection() {
  const { data, addComment, deleteComment } = useTaskDetail();
  const { smartTimer } = useTimer();
  const { user, profile } = useAuth();
  const colors = useThemeColors();
  const { showAlert, showConfirm } = useAlert();
  
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Mention system state
  const [eligibleUsers, setEligibleUsers] = useState<any[]>([]);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [cursorPos, setCursorPos] = useState(0);
  const [lastAck, setLastAck] = useState<string | null>(null);
  // Users picked in the composer; on send only those whose "@Name" is still in
  // the text are passed as p_mentioned_user_ids (the server re-sanitizes).
  const [picked, setPicked] = useState<{ id: string; name: string }[]>([]);
  const pickerRef = useRef<FlatList>(null);

  // id -> names, for highlighting @Name tokens of mentioned users.
  // ponytail: built from the mentionable list + me, so a user who has since
  // lost task access keeps the mention but loses the colour. Fetch missing ids
  // from users if that ever matters.
  const names = useMemo<NameMap>(() => {
    const map: NameMap = new Map();
    const add = (id: string | undefined, ...ns: (string | null | undefined)[]) => {
      if (id) map.set(id, ns.filter(Boolean) as string[]);
    };
    eligibleUsers.forEach(u => add(u.id, u.display_name, u.full_name));
    add(user?.id, profile?.display_name, profile?.full_name);
    return map;
  }, [eligibleUsers, user?.id, profile?.display_name, profile?.full_name]);

  const mentionsMe = (c: CommentData) => !!user?.id && !!c.mentioned_user_ids?.includes(user.id);

  // Fetch last acknowledgement time
  useEffect(() => {
    const fetchLastAck = async () => {
      if (!data?.task?.id || !user?.id) return;
      const { data: ack } = await supabase
        .from('task_mention_acks')
        .select('acknowledged_at')
        .eq('task_id', data.task.id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (ack) setLastAck(ack.acknowledged_at);
    };
    fetchLastAck();
  }, [data?.task?.id, user?.id]);

  // Mark mentions as read when viewed
  useEffect(() => {
    const hasNewMention = data?.comments?.some(c =>
      mentionsMe(c) && (!lastAck || new Date(c.created_at) > new Date(lastAck)));

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
      if (!data?.task?.id) return;

      // Same-company active users who can see this task (#461).
      const { data: users, error } = await supabase
        .rpc('rpc_task_mentionable_users', { p_task_id: data.task.id });

      if (!error && users) {
        setEligibleUsers(users);
      }
    };
    fetchEligibleUsers();
  }, [data?.task?.id]);

  const filteredUsers = useMemo(() => {
    if (!mentionQuery) return eligibleUsers;
    const q = mentionQuery.toLowerCase();
    return eligibleUsers.filter(u => 
      (u.full_name || '').toLowerCase().includes(q) || 
      (u.display_name || '').toLowerCase().includes(q)
    );
  }, [eligibleUsers, mentionQuery]);

  useEffect(() => { setActiveIdx(0); }, [mentionQuery, showMentionPicker]);

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
    setPicked(prev => [...prev, { id: user.id, name: nameToInsert }]);
    setShowMentionPicker(false);
  };

  // Web keyboard nav for the picker. Native has no hardware arrows; tap works there.
  const handlePickerKeyDown = (e: any) => {
    if (!showMentionPicker || filteredUsers.length === 0) return;
    const key = e.key ?? e.nativeEvent?.key;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      e.preventDefault();
      const next = key === 'ArrowDown'
        ? Math.min(activeIdx + 1, filteredUsers.length - 1)
        : Math.max(activeIdx - 1, 0);
      setActiveIdx(next);
      pickerRef.current?.scrollToIndex({ index: next, viewPosition: 0.5, animated: false });
    } else if ((key === 'Enter' && !e.shiftKey) || key === 'Tab') {
      e.preventDefault();
      const u = filteredUsers[Math.min(activeIdx, filteredUsers.length - 1)];
      if (u) handleSelectUser(u);
    } else if (key === 'Escape') {
      e.preventDefault();
      e.stopPropagation?.(); // don't also close an enclosing popup
      setShowMentionPicker(false);
    }
  };

  const tree = useMemo(() => buildTree(data?.comments || []), [data?.comments]);

  if (!data) return null;

  const replyComment = replyTo ? data.comments.find(c => c.id === replyTo) : null;

  const handleSend = async () => {
    if (!input.trim()) return;
    const text = input.trim();
    const mentionedIds = [...new Set(picked.filter(p => text.includes(`@${p.name}`)).map(p => p.id))];
    try {
      setSending(true);
      await addComment(text, replyTo, mentionedIds);
      setInput('');
      setPicked([]);
      setReplyTo(null);
    } catch (err: any) {
      showAlert('Comment Error', err.message);
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    showConfirm('Delete Comment', 'Are you sure?', () => deleteComment(commentId), undefined, 'Delete', undefined, 'destructive');
  };

  return (
    <CollapsibleCard
      title={`Comments (${data.comments.length})`}
      headerRight={data.comments.some(mentionsMe) && !data.comments.some(c =>
        mentionsMe(c) && (!lastAck || new Date(c.created_at) > new Date(lastAck))) ? (
        <View className="flex-row items-center">
          <FontAwesome name="check-circle" size={10} color={colors.success} />
          <Text className="text-state-success text-[9px] font-bold ml-1 uppercase">Mentions Cleared</Text>
        </View>
      ) : undefined}
    >
      {/* Comment tree */}
      {tree.length === 0 ? (
        <View className="py-4 items-center opacity-40">
          <FontAwesome name="comments-o" size={20} color={colors.textMuted} />
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
            names={names}
            colors={colors}
          />
        ))
      )}

      {/* Compose bar */}
      <PermissionGate allowed={data.permissions.can_comment}>
        <View className="mt-3 pt-3 border-t border-surface-border/30">
          {/* Reply indicator */}
          {replyComment && (
            <View className="flex-row items-center bg-surface-background rounded-lg px-3 py-2 mb-2 border border-surface-border/50">
              <FontAwesome name="reply" size={9} color={colors.primary} />
              <Text className="text-typography-muted text-[10px] ml-2 flex-1" numberOfLines={1}>
                Replying to <UserLink userId={replyComment.author?.id} name={replyComment.author?.full_name} className="text-typography-muted text-[10px]" />: {replyComment.content}
              </Text>
              <Tooltip label="Cancel reply">
                <TouchableOpacity onPress={() => setReplyTo(null)}>
                  <FontAwesome name="times" size={10} color={colors.textMuted} />
                </TouchableOpacity>
              </Tooltip>
            </View>
          )}

          {/* Mention Picker */}
          {showMentionPicker && filteredUsers.length > 0 && (
            <View className="bg-surface-background border border-surface-border rounded-xl mb-2 overflow-hidden max-h-[160px]">
              <FlatList
                ref={pickerRef}
                data={filteredUsers}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="always"
                onScrollToIndexFailed={() => {}}
                renderItem={({ item, index }) => (
                  <TouchableOpacity
                    onPress={() => handleSelectUser(item)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: index === activeIdx }}
                    className={`flex-row items-center p-3 border-b border-surface-border/30 active:bg-brand-primary/10 ${Platform.OS === 'web' && index === activeIdx ? 'bg-brand-primary/10' : ''}`}
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
              {...(Platform.OS === 'web' ? { onKeyDown: handlePickerKeyDown } as any : {})}
              placeholder={replyTo ? 'Write a reply...' : 'Write a comment...'}
              placeholderTextColor={colors.textMuted}
              multiline
              className="flex-1 bg-surface-background border border-surface-border rounded-xl px-3 py-2.5 text-typography-main text-sm max-h-[100px]"
            />
            <Tooltip label="Send comment">
              <TouchableOpacity
                onPress={handleSend}
                disabled={sending || !input.trim()}
                className={`bg-brand-primary p-2.5 rounded-xl ${(!input.trim() || sending) ? 'opacity-50' : ''}`}
              >
                {sending ? (
                  <ActivityIndicator size="small" color={colors.textMain} />
                ) : (
                  <FontAwesome name="paper-plane-o" size={14} color={colors.textMain} />
                )}
              </TouchableOpacity>
            </Tooltip>
          </View>
        </View>
      </PermissionGate>
    </CollapsibleCard>
  );
}
