import React, { useState, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useTaskDetail, CommentData } from '@/contexts/TaskDetailContext';
import { useTimer } from '@/contexts/TimerContext';
import { useAuth } from '@/contexts/AuthContext';
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

function CommentNode({ comment, depth, onReply, onDelete, canComment, currentUserId }: {
  comment: CommentTree; depth: number; onReply: (id: string) => void;
  onDelete: (id: string) => void; canComment: boolean; currentUserId: string | null;
}) {
  const maxIndent = Math.min(depth, 6); // Cap visual indent at 6 levels

  return (
    <View style={{ marginLeft: maxIndent * 16 }} className="mb-3">
      <View className={`${comment.is_system ? 'bg-surface-background' : 'bg-surface-card'} rounded-xl border border-surface-border/50 p-3`}>
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
        />
      ))}
    </View>
  );
}

export default function CommentsSection() {
  const { data, addComment, deleteComment } = useTaskDetail();
  const { smartTimer, passiveStart } = useTimer();
  const { user } = useAuth();
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

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
      <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.15em] mb-3">
        Comments ({data.comments.length})
      </Text>

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
          />
        ))
      )}

      {/* Compose bar */}
      <PermissionGate allowed={data.permissions.can_comment}>
        <View className="mt-3 pt-3 border-t border-surface-border/30">
          {/* Reply indicator */}
          {replyComment && (
            <View className="flex-row items-center bg-surface-background rounded-lg px-3 py-2 mb-2 border border-surface-border/50">
              <FontAwesome name="reply" size={9} color="#6366f1" />
              <Text className="text-typography-muted text-[10px] ml-2 flex-1" numberOfLines={1}>
                Replying to {replyComment.author?.full_name}: {replyComment.content}
              </Text>
              <TouchableOpacity onPress={() => setReplyTo(null)}>
                <FontAwesome name="times" size={10} color="#64748b" />
              </TouchableOpacity>
            </View>
          )}

          <View className="flex-row items-end gap-2">
            <TextInput
              value={input}
              onChangeText={(val) => {
                setInput(val);
                passiveStart(data.task.id, data.task.title);
              }}
              placeholder={replyTo ? 'Write a reply...' : 'Write a comment...'}
              placeholderTextColor="#64748b"
              multiline
              className="flex-1 bg-surface-background border border-surface-border rounded-xl px-3 py-2.5 text-typography-main text-sm max-h-[100px]"
            />
            <TouchableOpacity
              onPress={handleSend}
              disabled={sending || !input.trim()}
              className={`bg-brand-primary p-2.5 rounded-xl ${(!input.trim() || sending) ? 'opacity-50' : ''}`}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <FontAwesome name="send" size={14} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </PermissionGate>
    </View>
  );
}
