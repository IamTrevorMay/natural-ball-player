import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { MessageSquare, Plus, Users, User, Pin, Send, X, ArrowLeft, Bell } from 'lucide-react';

export default function Messages({ userId, userRole }) {
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);

  useEffect(() => {
    fetchConversations();
    fetchTeams();
    fetchUsers();
    
    // Subscribe to real-time message updates
    const subscription = supabase
      .channel('messages')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'messages' }, 
        () => {
          fetchConversations();
          if (selectedConversation) {
            fetchConversationDetail(selectedConversation.id);
          }
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [userId]);

  const fetchConversations = async () => {
    const { data, error } = await supabase
      .from('conversations')
      .select(`
        *,
        conversation_participants!inner(user_id),
        messages(id, content, created_at, sender_id),
        teams(name)
      `)
      .eq('conversation_participants.user_id', userId)
      .order('updated_at', { ascending: false });

    if (!error && data) {
      // Get unread counts for each conversation
      const conversationsWithCounts = await Promise.all(
        data.map(async (conv) => {
          const { data: unreadCount } = await supabase
            .rpc('get_unread_count', {
              p_user_id: userId,
              p_conversation_id: conv.id
            });
          
          return {
            ...conv,
            unreadCount: unreadCount || 0,
            lastMessage: conv.messages?.[conv.messages.length - 1]
          };
        })
      );
      
      setConversations(conversationsWithCounts);
    }
    setLoading(false);
  };

  const fetchTeams = async () => {
    if (userRole === 'admin' || userRole === 'coach') {
      const { data } = await supabase.from('teams').select('*').order('name');
      if (data) setTeams(data);
    }
  };

  const fetchUsers = async () => {
    if (userRole === 'admin' || userRole === 'coach') {
      const { data } = await supabase
        .from('users')
        .select('id, full_name, role')
        .order('full_name');
      if (data) setUsers(data);
    }
  };

  const fetchConversationDetail = async (conversationId) => {
    const { data, error } = await supabase
      .from('conversations')
      .select(`
        *,
        conversation_participants(user_id, users(id, full_name, role)),
        messages(*, sender:users(id, full_name, role)),
        teams(name)
      `)
      .eq('id', conversationId)
      .single();

    if (!error && data) {
      // Sort messages by created_at
      data.messages = data.messages.sort((a, b) => 
        new Date(a.created_at) - new Date(b.created_at)
      );
      setSelectedConversation(data);
      
      // Mark messages as read
      const unreadMessages = data.messages.filter(m => 
        m.sender_id !== userId && !m.read
      );
      
      if (unreadMessages.length > 0) {
        await Promise.all(
          unreadMessages.map(msg => 
            supabase.from('message_reads').insert({
              message_id: msg.id,
              user_id: userId
            })
          )
        );
        fetchConversations(); // Refresh to update unread counts
      }
    }
  };

  const togglePin = async (conversationId, currentPinned) => {
    await supabase
      .from('conversations')
      .update({ is_pinned: !currentPinned })
      .eq('id', conversationId);
    
    fetchConversations();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Loading messages...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Messages</h2>
          <p className="text-gray-600 mt-1">Team communication and announcements</p>
        </div>
        {(userRole === 'admin' || userRole === 'coach') && (
          <button
            onClick={() => setShowNewMessage(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition flex items-center space-x-2"
          >
            <Plus size={18} />
            <span>New Message</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Conversations List */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg shadow">
            <div className="p-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900">Conversations</h3>
            </div>
            <div className="divide-y divide-gray-200 max-h-[600px] overflow-y-auto">
              {conversations.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <MessageSquare size={40} className="mx-auto mb-3 text-gray-300" />
                  <p>No messages yet</p>
                </div>
              ) : (
                conversations.map((conv) => (
                  <ConversationItem
                    key={conv.id}
                    conversation={conv}
                    isSelected={selectedConversation?.id === conv.id}
                    onClick={() => fetchConversationDetail(conv.id)}
                    onTogglePin={() => togglePin(conv.id, conv.is_pinned)}
                    userId={userId}
                    userRole={userRole}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        {/* Conversation Detail */}
        <div className="lg:col-span-2">
          {selectedConversation ? (
            <ConversationDetail
              conversation={selectedConversation}
              userId={userId}
              onBack={() => setSelectedConversation(null)}
              onRefresh={() => fetchConversationDetail(selectedConversation.id)}
            />
          ) : (
            <div className="bg-white rounded-lg shadow p-12 text-center">
              <MessageSquare size={64} className="mx-auto mb-4 text-gray-300" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Select a conversation
              </h3>
              <p className="text-gray-600">
                Choose a conversation from the list to view messages
              </p>
            </div>
          )}
        </div>
      </div>

      {showNewMessage && (
        <NewMessageModal
          teams={teams}
          users={users}
          userId={userId}
          userRole={userRole}
          onClose={() => setShowNewMessage(false)}
          onSuccess={() => {
            setShowNewMessage(false);
            fetchConversations();
          }}
        />
      )}
    </div>
  );
}

function ConversationItem({ conversation, isSelected, onClick, onTogglePin, userId, userRole }) {
  const getConversationTitle = () => {
    if (conversation.type === 'team_announcement') {
      return `${conversation.teams?.name || 'Team'} - ${conversation.title}`;
    } else if (conversation.type === 'group') {
      return conversation.title;
    } else {
      // Direct message - show other participant's name
      const otherParticipant = conversation.conversation_participants?.find(
        p => p.user_id !== userId
      );
      return otherParticipant?.users?.full_name || 'Direct Message';
    }
  };

  const getIcon = () => {
    if (conversation.type === 'team_announcement' || conversation.type === 'group') {
      return <Users size={16} />;
    }
    return <User size={16} />;
  };

  return (
    <div
      onClick={onClick}
      className={`p-4 cursor-pointer hover:bg-gray-50 transition ${
        isSelected ? 'bg-blue-50 border-l-4 border-blue-600' : ''
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2 mb-1">
            {getIcon()}
            <h4 className="font-semibold text-gray-900 truncate text-sm">
              {getConversationTitle()}
            </h4>
            {conversation.is_pinned && (
              <Pin size={14} className="text-orange-500 flex-shrink-0" />
            )}
          </div>
          {conversation.lastMessage && (
            <p className="text-xs text-gray-600 truncate">
              {conversation.lastMessage.content}
            </p>
          )}
          <p className="text-xs text-gray-400 mt-1">
            {conversation.updated_at && 
              new Date(conversation.updated_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex flex-col items-end space-y-1 ml-2">
          {conversation.unreadCount > 0 && (
            <span className="bg-blue-600 text-white text-xs font-bold rounded-full h-5 min-w-[20px] flex items-center justify-center px-1.5">
              {conversation.unreadCount}
            </span>
          )}
          {(userRole === 'admin' || userRole === 'coach') && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin();
              }}
              className="text-gray-400 hover:text-orange-500 transition"
            >
              <Pin size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ConversationDetail({ conversation, userId, onBack, onRefresh }) {
  const [newMessage, setNewMessage] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [sending, setSending] = useState(false);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    setSending(true);
    const { error } = await supabase.from('messages').insert({
      conversation_id: conversation.id,
      sender_id: userId,
      content: newMessage.trim(),
      parent_message_id: replyingTo?.id || null
    });

    if (!error) {
      setNewMessage('');
      setReplyingTo(null);
      onRefresh();
    }
    setSending(false);
  };

  const getReplies = (messageId) => {
    return conversation.messages.filter(m => m.parent_message_id === messageId);
  };

  const topLevelMessages = conversation.messages.filter(m => !m.parent_message_id);

  return (
    <div className="bg-white rounded-lg shadow flex flex-col h-[600px]">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="lg:hidden text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h3 className="font-semibold text-gray-900">
              {conversation.type === 'team_announcement' 
                ? `${conversation.teams?.name} - ${conversation.title}`
                : conversation.type === 'group'
                ? conversation.title
                : 'Direct Message'
              }
            </h3>
            <p className="text-xs text-gray-500">
              {conversation.conversation_participants?.length || 0} participants
            </p>
          </div>
        </div>
        {conversation.type === 'team_announcement' && (
          <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium flex items-center space-x-1">
            <Bell size={12} />
            <span>Announcement</span>
          </span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {topLevelMessages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            isOwn={message.sender_id === userId}
            onReply={() => setReplyingTo(message)}
            replies={getReplies(message.id)}
            userId={userId}
          />
        ))}
      </div>

      {/* Reply indicator */}
      {replyingTo && (
        <div className="px-4 py-2 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
          <div className="text-sm">
            <span className="text-gray-600">Replying to </span>
            <span className="font-medium">{replyingTo.sender.full_name}</span>
          </div>
          <button
            onClick={() => setReplyingTo(null)}
            className="text-gray-400 hover:text-gray-600"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSend} className="p-4 border-t border-gray-200">
        <div className="flex space-x-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type your message..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={sending || !newMessage.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50 flex items-center space-x-2"
          >
            <Send size={18} />
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message, isOwn, onReply, replies, userId }) {
  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[70%] ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
        {!isOwn && (
          <div className="flex items-center space-x-2 mb-1">
            <span className="text-xs font-semibold text-gray-900">
              {message.sender?.full_name}
            </span>
            <span className="text-xs text-gray-500">
              {message.sender?.role}
            </span>
          </div>
        )}
        <div
          className={`rounded-lg px-4 py-2 ${
            isOwn
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-900'
          }`}
        >
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        </div>
        <div className="flex items-center space-x-2 mt-1">
          <span className="text-xs text-gray-500">
            {new Date(message.created_at).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit'
            })}
          </span>
          {!isOwn && (
            <button
              onClick={onReply}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              Reply
            </button>
          )}
        </div>

        {/* Replies */}
        {replies && replies.length > 0 && (
          <div className="mt-2 space-y-2 pl-4 border-l-2 border-gray-300">
            {replies.map((reply) => (
              <MessageBubble
                key={reply.id}
                message={reply}
                isOwn={reply.sender_id === userId}
                onReply={onReply}
                userId={userId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NewMessageModal({ teams, users, userId, userRole, onClose, onSuccess }) {
  const [messageType, setMessageType] = useState('direct');
  const [formData, setFormData] = useState({
    title: '',
    teamId: '',
    recipientIds: [],
    content: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // Create conversation
      const conversationData = {
        type: messageType,
        created_by: userId
      };

      if (messageType === 'team_announcement') {
        conversationData.title = formData.title;
        conversationData.team_id = formData.teamId;
      } else if (messageType === 'group') {
        conversationData.title = formData.title;
      }

      const { data: conversation, error: convError } = await supabase
        .from('conversations')
        .insert(conversationData)
        .select()
        .single();

      if (convError) throw convError;

      // Add participants
      const participants = [];
      
      if (messageType === 'team_announcement') {
        // Get all team members
        const { data: teamMembers } = await supabase
          .from('team_members')
          .select('user_id')
          .eq('team_id', formData.teamId);
        
        participants.push(...teamMembers.map(tm => ({
          conversation_id: conversation.id,
          user_id: tm.user_id
        })));
        
        // Add creator if not in team
        if (!teamMembers.some(tm => tm.user_id === userId)) {
          participants.push({
            conversation_id: conversation.id,
            user_id: userId
          });
        }
      } else {
        // Direct or group - add selected recipients + creator
        participants.push({
          conversation_id: conversation.id,
          user_id: userId
        });
        formData.recipientIds.forEach(recipientId => {
          participants.push({
            conversation_id: conversation.id,
            user_id: recipientId
          });
        });
      }

      const { error: participantsError } = await supabase
        .from('conversation_participants')
        .insert(participants);

      if (participantsError) throw participantsError;

      // Send initial message
      const { error: messageError } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversation.id,
          sender_id: userId,
          content: formData.content
        });

      if (messageError) throw messageError;

      onSuccess();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const toggleRecipient = (recipientId) => {
    setFormData(prev => ({
      ...prev,
      recipientIds: prev.recipientIds.includes(recipientId)
        ? prev.recipientIds.filter(id => id !== recipientId)
        : [...prev.recipientIds, recipientId]
    }));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between">
          <h3 className="text-xl font-bold text-gray-900">New Message</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          {/* Message Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Message Type *
            </label>
            <div className="flex space-x-2">
              <button
                type="button"
                onClick={() => setMessageType('direct')}
                className={`flex-1 py-2 px-4 rounded-lg font-medium transition ${
                  messageType === 'direct'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Direct Message
              </button>
              <button
                type="button"
                onClick={() => setMessageType('group')}
                className={`flex-1 py-2 px-4 rounded-lg font-medium transition ${
                  messageType === 'group'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Group Chat
              </button>
              <button
                type="button"
                onClick={() => setMessageType('team_announcement')}
                className={`flex-1 py-2 px-4 rounded-lg font-medium transition ${
                  messageType === 'team_announcement'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Team Announcement
              </button>
            </div>
          </div>

          {/* Title (for groups and announcements) */}
          {(messageType === 'group' || messageType === 'team_announcement') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Title *
              </label>
              <input
                type="text"
                required
                placeholder="e.g., Practice Update, Game Day Info"
                value={formData.title}
                onChange={(e) => setFormData({...formData, title: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {/* Team selection (for announcements) */}
          {messageType === 'team_announcement' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Team *
              </label>
              <select
                required
                value={formData.teamId}
                onChange={(e) => setFormData({...formData, teamId: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select team</option>
                {teams.map(team => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Recipient selection (for direct and group) */}
          {(messageType === 'direct' || messageType === 'group') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Recipients * {messageType === 'direct' && '(select one)'}
              </label>
              <div className="border border-gray-300 rounded-lg p-3 max-h-48 overflow-y-auto space-y-2">
                {users.filter(u => u.id !== userId).map(user => (
                  <label
                    key={user.id}
                    className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded"
                  >
                    <input
                      type={messageType === 'direct' ? 'radio' : 'checkbox'}
                      checked={formData.recipientIds.includes(user.id)}
                      onChange={() => {
                        if (messageType === 'direct') {
                          setFormData({...formData, recipientIds: [user.id]});
                        } else {
                          toggleRecipient(user.id);
                        }
                      }}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-900">{user.full_name}</span>
                    <span className="text-xs text-gray-500">({user.role})</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Message content */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Message *
            </label>
            <textarea
              required
              value={formData.content}
              onChange={(e) => setFormData({...formData, content: e.target.value})}
              rows="6"
              placeholder="Type your message..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
            >
              {loading ? 'Sending...' : 'Send Message'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
