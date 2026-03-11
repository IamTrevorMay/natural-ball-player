import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { MessageSquare, Plus, Users, User, Pin, Send, X, ArrowLeft, Bell, UserPlus, UserMinus, Search } from 'lucide-react';

export default function Messages({ userId, userRole }) {
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [selectedChat, setSelectedChat] = useState(null);
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);

  const messageConvos = conversations.filter(c => c.type === 'direct' || c.type === 'team_announcement');
  const chatRooms = conversations.filter(c => c.type === 'group');

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
            fetchConversationDetail(selectedConversation.id, 'message');
          }
          if (selectedChat) {
            fetchConversationDetail(selectedChat.id, 'chat');
          }
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [userId]);

  const fetchConversations = async () => {
    // Step 1: Get my conversation IDs
    const { data: participantData, error: partError } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', userId);

    if (partError || !participantData || participantData.length === 0) {
      setConversations([]);
      setLoading(false);
      return;
    }

    const conversationIds = participantData.map(p => p.conversation_id);

    // Step 2: Get conversation details
    const { data: convData, error: convError } = await supabase
      .from('conversations')
      .select('*')
      .in('id', conversationIds)
      .order('updated_at', { ascending: false });

    if (convError || !convData) {
      setConversations([]);
      setLoading(false);
      return;
    }

    // Step 3: Enhance with messages and team info
    const enhanced = await Promise.all(
      convData.map(async (conv) => {
        const { data: msgs } = await supabase
          .from('messages')
          .select('id, content, created_at, sender_id')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: false })
          .limit(1);

        let teamName = null;
        if (conv.team_id) {
          const { data: team } = await supabase
            .from('teams')
            .select('name')
            .eq('id', conv.team_id)
            .single();
          teamName = team?.name;
        }

        return {
          ...conv,
          messages: msgs || [],
          lastMessage: msgs?.[0],
          teams: teamName ? { name: teamName } : null,
          unreadCount: 0,
          conversation_participants: []
        };
      })
    );

    setConversations(enhanced);
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

  const fetchConversationDetail = async (conversationId, target) => {
    const { data: conv, error: convError } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single();

    if (convError || !conv) return;

    const { data: participants } = await supabase
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', conversationId);

    const participantsWithUsers = [];
    if (participants) {
      for (const p of participants) {
        const { data: user } = await supabase
          .from('users')
          .select('id, full_name, role')
          .eq('id', p.user_id)
          .single();
        if (user) {
          participantsWithUsers.push({ user_id: p.user_id, users: user });
        }
      }
    }

    const { data: messages } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    const messagesWithSenders = [];
    if (messages) {
      for (const msg of messages) {
        const { data: sender } = await supabase
          .from('users')
          .select('id, full_name, role')
          .eq('id', msg.sender_id)
          .single();
        messagesWithSenders.push({
          ...msg,
          sender: sender || { id: msg.sender_id, full_name: 'Unknown', role: 'unknown' }
        });
      }
    }

    let teamData = null;
    if (conv.team_id) {
      const { data: team } = await supabase
        .from('teams')
        .select('name')
        .eq('id', conv.team_id)
        .single();
      teamData = team;
    }

    const fullConversation = {
      ...conv,
      conversation_participants: participantsWithUsers,
      messages: messagesWithSenders,
      teams: teamData
    };

    if (target === 'chat') {
      setSelectedChat(fullConversation);
    } else {
      setSelectedConversation(fullConversation);
    }

    // Mark messages as read
    const unreadMessages = messagesWithSenders.filter(m =>
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
      fetchConversations();
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
        <p className="text-gray-600">Loading communication...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h2 className="text-3xl font-bold text-gray-900">Communication</h2>
        <p className="text-gray-600 mt-1">Messages, announcements, and chat rooms</p>
      </div>

      {/* ========== MESSAGES SECTION ========== */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-gray-900">Messages</h3>
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
          {/* Message Conversations List */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow">
              <div className="p-4 border-b border-gray-200">
                <h4 className="font-semibold text-gray-900 text-sm">Conversations</h4>
              </div>
              <div className="divide-y divide-gray-200 max-h-[400px] overflow-y-auto">
                {messageConvos.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">
                    <MessageSquare size={40} className="mx-auto mb-3 text-gray-300" />
                    <p>No messages yet</p>
                  </div>
                ) : (
                  messageConvos.map((conv) => (
                    <ConversationItem
                      key={conv.id}
                      conversation={conv}
                      isSelected={selectedConversation?.id === conv.id}
                      onClick={() => fetchConversationDetail(conv.id, 'message')}
                      onTogglePin={() => togglePin(conv.id, conv.is_pinned)}
                      userId={userId}
                      userRole={userRole}
                    />
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Message Detail */}
          <div className="lg:col-span-2">
            {selectedConversation ? (
              <ConversationDetail
                conversation={selectedConversation}
                userId={userId}
                userRole={userRole}
                users={users}
                onBack={() => setSelectedConversation(null)}
                onRefresh={() => fetchConversationDetail(selectedConversation.id, 'message')}
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
      </div>

      {/* ========== CHAT ROOMS SECTION ========== */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-gray-900">Chat Rooms</h3>
          {(userRole === 'admin' || userRole === 'coach') && (
            <button
              onClick={() => setShowNewChat(true)}
              className="bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 transition flex items-center space-x-2"
            >
              <Plus size={18} />
              <span>New Chat Room</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chat Room List */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow">
              <div className="p-4 border-b border-gray-200">
                <h4 className="font-semibold text-gray-900 text-sm">Rooms</h4>
              </div>
              <div className="divide-y divide-gray-200 max-h-[400px] overflow-y-auto">
                {chatRooms.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">
                    <Users size={40} className="mx-auto mb-3 text-gray-300" />
                    <p>No chat rooms yet</p>
                  </div>
                ) : (
                  chatRooms.map((conv) => (
                    <ConversationItem
                      key={conv.id}
                      conversation={conv}
                      isSelected={selectedChat?.id === conv.id}
                      onClick={() => fetchConversationDetail(conv.id, 'chat')}
                      onTogglePin={() => togglePin(conv.id, conv.is_pinned)}
                      userId={userId}
                      userRole={userRole}
                    />
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Chat Room Detail */}
          <div className="lg:col-span-2">
            {selectedChat ? (
              <ChatRoomDetail
                conversation={selectedChat}
                userId={userId}
                userRole={userRole}
                users={users}
                onBack={() => setSelectedChat(null)}
                onRefresh={() => fetchConversationDetail(selectedChat.id, 'chat')}
              />
            ) : (
              <div className="bg-white rounded-lg shadow p-12 text-center">
                <Users size={64} className="mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Select a chat room
                </h3>
                <p className="text-gray-600">
                  Choose a chat room from the list to start chatting
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
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

      {showNewChat && (
        <NewChatRoomModal
          users={users}
          userId={userId}
          onClose={() => setShowNewChat(false)}
          onSuccess={() => {
            setShowNewChat(false);
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

function MemberPanel({ conversation, userId, userRole, users, onAddMember, onRemoveMember, onClose }) {
  const [searchQuery, setSearchQuery] = useState('');
  const isCreator = conversation.created_by === userId;
  const canManage = isCreator || userRole === 'admin' || userRole === 'coach';

  const participantIds = (conversation.conversation_participants || []).map(p => p.user_id);
  const availableUsers = users.filter(u =>
    !participantIds.includes(u.id) &&
    u.full_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="w-72 border-l border-gray-200 flex flex-col h-full bg-gray-50">
      <div className="p-3 border-b border-gray-200 flex items-center justify-between bg-white">
        <h4 className="font-semibold text-gray-900 text-sm">Members ({participantIds.length})</h4>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {(conversation.conversation_participants || []).map(p => (
          <div key={p.user_id} className="flex items-center justify-between p-2 rounded hover:bg-gray-100">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {p.users?.full_name || 'Unknown'}
              </p>
              <div className="flex items-center space-x-1">
                <span className="text-xs text-gray-500">{p.users?.role}</span>
                {p.user_id === conversation.created_by && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">Creator</span>
                )}
              </div>
            </div>
            {canManage && p.user_id !== userId && (
              <button
                onClick={() => onRemoveMember(p.user_id)}
                className="text-gray-400 hover:text-red-500 ml-2"
                title="Remove member"
              >
                <UserMinus size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      {canManage && (
        <div className="border-t border-gray-200 p-3 bg-white">
          <p className="text-xs font-medium text-gray-700 mb-2">Add Members</p>
          <div className="relative mb-2">
            <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search users..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="max-h-32 overflow-y-auto space-y-1">
            {availableUsers.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-2">
                {searchQuery ? 'No users found' : 'All users added'}
              </p>
            ) : (
              availableUsers.map(user => (
                <button
                  key={user.id}
                  onClick={() => onAddMember(user.id)}
                  className="w-full flex items-center justify-between p-2 text-left rounded hover:bg-gray-50 text-sm"
                >
                  <span className="truncate">{user.full_name}</span>
                  <UserPlus size={14} className="text-blue-600 flex-shrink-0 ml-2" />
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ConversationDetail({ conversation, userId, userRole, users, onBack, onRefresh }) {
  const [newMessage, setNewMessage] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [sending, setSending] = useState(false);
  const [showMemberPanel, setShowMemberPanel] = useState(false);

  const canReply = !conversation.replies_disabled || userRole === 'admin' || userRole === 'coach';

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

  const handleAddMember = async (memberId) => {
    const { error } = await supabase.from('conversation_participants').insert({
      conversation_id: conversation.id,
      user_id: memberId
    });
    if (!error) onRefresh();
  };

  const handleRemoveMember = async (memberId) => {
    const { error } = await supabase
      .from('conversation_participants')
      .delete()
      .eq('conversation_id', conversation.id)
      .eq('user_id', memberId);
    if (!error) onRefresh();
  };

  const getReplies = (messageId) => {
    return conversation.messages.filter(m => m.parent_message_id === messageId);
  };

  const topLevelMessages = conversation.messages.filter(m => !m.parent_message_id);
  const isTeamAnnouncement = conversation.type === 'team_announcement';

  return (
    <div className="bg-white rounded-lg shadow flex h-[400px]">
      <div className="flex-1 flex flex-col min-w-0">
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
                  : 'Direct Message'
                }
              </h3>
              {isTeamAnnouncement ? (
                <button
                  onClick={() => setShowMemberPanel(!showMemberPanel)}
                  className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                >
                  {conversation.conversation_participants?.length || 0} members
                </button>
              ) : (
                <p className="text-xs text-gray-500">
                  {conversation.conversation_participants?.length || 0} participants
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {isTeamAnnouncement && (
              <button
                onClick={() => setShowMemberPanel(!showMemberPanel)}
                className={`p-1.5 rounded transition ${showMemberPanel ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:text-gray-600'}`}
                title="Manage members"
              >
                <Users size={18} />
              </button>
            )}
            {conversation.type === 'team_announcement' && (
              <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium flex items-center space-x-1">
                <Bell size={12} />
                <span>Announcement</span>
              </span>
            )}
            {conversation.replies_disabled && (
              <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium">
                Replies Off
              </span>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {topLevelMessages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              isOwn={message.sender_id === userId}
              onReply={canReply ? () => setReplyingTo(message) : null}
              replies={getReplies(message.id)}
              userId={userId}
            />
          ))}
        </div>

        {/* Reply indicator */}
        {replyingTo && canReply && (
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
        {canReply ? (
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
        ) : (
          <div className="p-4 border-t border-gray-200 bg-gray-50">
            <p className="text-sm text-gray-600 text-center italic flex items-center justify-center space-x-2">
              <span>Replies are disabled for this announcement</span>
            </p>
          </div>
        )}
      </div>

      {/* Member Panel (for team announcements) */}
      {showMemberPanel && isTeamAnnouncement && (
        <MemberPanel
          conversation={conversation}
          userId={userId}
          userRole={userRole}
          users={users}
          onAddMember={handleAddMember}
          onRemoveMember={handleRemoveMember}
          onClose={() => setShowMemberPanel(false)}
        />
      )}
    </div>
  );
}

function ChatRoomDetail({ conversation, userId, userRole, users, onBack, onRefresh }) {
  const [newMessage, setNewMessage] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [sending, setSending] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const canReply = !conversation.replies_disabled || userRole === 'admin' || userRole === 'coach';
  const isCreator = conversation.created_by === userId;
  const canManage = isCreator || userRole === 'admin' || userRole === 'coach';

  const participantIds = (conversation.conversation_participants || []).map(p => p.user_id);
  const availableUsers = users.filter(u =>
    !participantIds.includes(u.id) &&
    u.full_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

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

  const handleAddMember = async (memberId) => {
    const { error } = await supabase.from('conversation_participants').insert({
      conversation_id: conversation.id,
      user_id: memberId
    });
    if (!error) onRefresh();
  };

  const handleRemoveMember = async (memberId) => {
    const { error } = await supabase
      .from('conversation_participants')
      .delete()
      .eq('conversation_id', conversation.id)
      .eq('user_id', memberId);
    if (!error) onRefresh();
  };

  const getReplies = (messageId) => {
    return conversation.messages.filter(m => m.parent_message_id === messageId);
  };

  const topLevelMessages = conversation.messages.filter(m => !m.parent_message_id);

  return (
    <div className="bg-white rounded-lg shadow flex h-[400px]">
      {/* Chat Messages Area */}
      <div className="flex-1 flex flex-col min-w-0">
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
              <h3 className="font-semibold text-gray-900">{conversation.title}</h3>
              <p className="text-xs text-gray-500">
                {conversation.conversation_participants?.length || 0} members
              </p>
            </div>
          </div>
          {conversation.replies_disabled && (
            <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium">
              Replies Off
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
              onReply={canReply ? () => setReplyingTo(message) : null}
              replies={getReplies(message.id)}
              userId={userId}
            />
          ))}
        </div>

        {/* Reply indicator */}
        {replyingTo && canReply && (
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
        {canReply ? (
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
        ) : (
          <div className="p-4 border-t border-gray-200 bg-gray-50">
            <p className="text-sm text-gray-600 text-center italic">
              Replies are disabled for this chat
            </p>
          </div>
        )}
      </div>

      {/* Always-visible Member Sidebar */}
      <div className="w-56 border-l border-gray-200 flex flex-col h-full bg-gray-50 hidden lg:flex">
        <div className="p-3 border-b border-gray-200 bg-white">
          <h4 className="font-semibold text-gray-900 text-sm">Members ({participantIds.length})</h4>
        </div>

        {/* Member list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {(conversation.conversation_participants || []).map(p => (
            <div key={p.user_id} className="flex items-center justify-between p-2 rounded hover:bg-gray-100">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {p.users?.full_name || 'Unknown'}
                </p>
                <div className="flex items-center space-x-1">
                  <span className="text-xs text-gray-500">{p.users?.role}</span>
                  {p.user_id === conversation.created_by && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">Creator</span>
                  )}
                </div>
              </div>
              {canManage && p.user_id !== userId && (
                <button
                  onClick={() => handleRemoveMember(p.user_id)}
                  className="text-gray-400 hover:text-red-500 ml-1"
                  title="Remove member"
                >
                  <UserMinus size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Invite More */}
        {canManage && (
          <div className="border-t border-gray-200 p-3 bg-white">
            {!showInvite ? (
              <button
                onClick={() => setShowInvite(true)}
                className="w-full flex items-center justify-center space-x-2 py-2 text-sm font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition"
              >
                <UserPlus size={16} />
                <span>Invite More</span>
              </button>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-gray-700">Add Members</p>
                  <button onClick={() => { setShowInvite(false); setSearchQuery(''); }} className="text-gray-400 hover:text-gray-600">
                    <X size={14} />
                  </button>
                </div>
                <div className="relative mb-2">
                  <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search users..."
                    className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {availableUsers.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-2">
                      {searchQuery ? 'No users found' : 'All users added'}
                    </p>
                  ) : (
                    availableUsers.map(user => (
                      <button
                        key={user.id}
                        onClick={() => handleAddMember(user.id)}
                        className="w-full flex items-center justify-between p-2 text-left rounded hover:bg-gray-50 text-sm"
                      >
                        <span className="truncate">{user.full_name}</span>
                        <UserPlus size={14} className="text-blue-600 flex-shrink-0 ml-1" />
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
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
          {!isOwn && onReply && (
            <button
              onClick={onReply}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              Reply
            </button>
          )}
        </div>

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
  const [repliesDisabled, setRepliesDisabled] = useState(false);
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
      const conversationData = {
        type: messageType,
        created_by: userId,
        is_pinned: false,
        replies_disabled: messageType !== 'direct' ? repliesDisabled : false
      };

      if (messageType === 'team_announcement') {
        conversationData.title = formData.title;
        conversationData.team_id = formData.teamId;
      }

      const { data: conversation, error: convError } = await supabase
        .from('conversations')
        .insert(conversationData)
        .select()
        .single();

      if (convError) throw convError;

      const participants = [];

      if (messageType === 'team_announcement') {
        const { data: teamMembers } = await supabase
          .from('team_members')
          .select('user_id')
          .eq('team_id', formData.teamId);

        participants.push(...teamMembers.map(tm => ({
          conversation_id: conversation.id,
          user_id: tm.user_id
        })));

        if (!teamMembers.some(tm => tm.user_id === userId)) {
          participants.push({
            conversation_id: conversation.id,
            user_id: userId
          });
        }
      } else {
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

          {/* Message Type - only Direct Message and Team Announcement */}
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

          {/* Title (for announcements) */}
          {messageType === 'team_announcement' && (
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

          {/* Recipient selection (for direct messages) */}
          {messageType === 'direct' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Recipient * (select one)
              </label>
              <div className="border border-gray-300 rounded-lg p-3 max-h-48 overflow-y-auto space-y-2">
                {users.filter(u => u.id !== userId).map(user => (
                  <label
                    key={user.id}
                    className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded"
                  >
                    <input
                      type="radio"
                      checked={formData.recipientIds.includes(user.id)}
                      onChange={() => setFormData({...formData, recipientIds: [user.id]})}
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

          {/* Toggle Replies Checkbox - Only for team announcements */}
          {messageType === 'team_announcement' && (
            <div className="border-t border-gray-200 pt-4">
              <label className="flex items-center space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={repliesDisabled}
                  onChange={(e) => setRepliesDisabled(e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <div>
                  <span className="text-sm font-medium text-gray-700">
                    Disable replies (announcement only)
                  </span>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Players won't be able to reply. Coaches and admins can still respond.
                  </p>
                </div>
              </label>
            </div>
          )}

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

function NewChatRoomModal({ users, userId, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    title: '',
    recipientIds: [],
    content: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const toggleRecipient = (recipientId) => {
    setFormData(prev => ({
      ...prev,
      recipientIds: prev.recipientIds.includes(recipientId)
        ? prev.recipientIds.filter(id => id !== recipientId)
        : [...prev.recipientIds, recipientId]
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { data: conversation, error: convError } = await supabase
        .from('conversations')
        .insert({
          type: 'group',
          title: formData.title,
          created_by: userId,
          is_pinned: false,
          replies_disabled: false
        })
        .select()
        .single();

      if (convError) throw convError;

      const participants = [
        { conversation_id: conversation.id, user_id: userId },
        ...formData.recipientIds.map(id => ({
          conversation_id: conversation.id,
          user_id: id
        }))
      ];

      const { error: participantsError } = await supabase
        .from('conversation_participants')
        .insert(participants);

      if (participantsError) throw participantsError;

      if (formData.content.trim()) {
        const { error: messageError } = await supabase
          .from('messages')
          .insert({
            conversation_id: conversation.id,
            sender_id: userId,
            content: formData.content.trim()
          });

        if (messageError) throw messageError;
      }

      onSuccess();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between">
          <h3 className="text-xl font-bold text-gray-900">New Chat Room</h3>
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

          {/* Chat Room Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Chat Room Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g., Game Strategy, Social, Fitness Tips"
              value={formData.title}
              onChange={(e) => setFormData({...formData, title: e.target.value})}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Member Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Invite Members *
            </label>
            <div className="border border-gray-300 rounded-lg p-3 max-h-48 overflow-y-auto space-y-2">
              {users.filter(u => u.id !== userId).map(user => (
                <label
                  key={user.id}
                  className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded"
                >
                  <input
                    type="checkbox"
                    checked={formData.recipientIds.includes(user.id)}
                    onChange={() => toggleRecipient(user.id)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-900">{user.full_name}</span>
                  <span className="text-xs text-gray-500">({user.role})</span>
                </label>
              ))}
            </div>
            {formData.recipientIds.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">{formData.recipientIds.length} member(s) selected</p>
            )}
          </div>

          {/* Initial Message */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Initial Message (optional)
            </label>
            <textarea
              value={formData.content}
              onChange={(e) => setFormData({...formData, content: e.target.value})}
              rows="4"
              placeholder="Send an optional first message..."
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
              disabled={loading || formData.recipientIds.length === 0}
              className="flex-1 bg-green-600 text-white py-3 rounded-lg font-medium hover:bg-green-700 transition disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Chat Room'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
