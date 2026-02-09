import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { BookOpen, Search, MessageCircle, Plus, Eye, Tag, Calendar, User as UserIcon, Send, Loader, Sparkles, ArrowLeft, Edit } from 'lucide-react';

export default function KnowledgeBase({ userId, userRole }) {
  const [activeView, setActiveView] = useState('browse'); // browse, article, ai-assistant
  const [categories, setCategories] = useState([]);
  const [articles, setArticles] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCategories();
    fetchArticles();
  }, []);

  const fetchCategories = async () => {
    const { data } = await supabase
      .from('knowledge_categories')
      .select('*')
      .order('sort_order');
    
    if (data) setCategories(data);
    setLoading(false);
  };

  const fetchArticles = async () => {
    const { data } = await supabase
      .from('knowledge_articles')
      .select(`
        *,
        author:author_id(full_name),
        category:category_id(name, color)
      `)
      .eq('is_published', true)
      .order('created_at', { ascending: false });
    
    if (data) setArticles(data);
  };

  const handleArticleClick = async (article) => {
    setSelectedArticle(article);
    setActiveView('article');
    
    // Track view
    await supabase.from('article_views').insert({
      article_id: article.id,
      user_id: userId
    });

    // Increment view count
    await supabase
      .from('knowledge_articles')
      .update({ view_count: article.view_count + 1 })
      .eq('id', article.id);
  };

  const filteredArticles = articles.filter(article => {
    const matchesCategory = !selectedCategory || article.category_id === selectedCategory;
    const matchesSearch = !searchQuery || 
      article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      article.summary?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      article.tags?.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Loading knowledge base...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Knowledge Base</h2>
          <p className="text-gray-600 mt-1">Learn, train, and improve your game</p>
        </div>
        <div className="flex items-center space-x-3">
          {(userRole === 'admin' || userRole === 'coach') && activeView === 'browse' && (
            <button
              onClick={() => alert('Article creation form coming soon!')}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition flex items-center space-x-2"
            >
              <Plus size={18} />
              <span>Add Article</span>
            </button>
          )}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-white rounded-lg shadow">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6">
            <button
              onClick={() => setActiveView('browse')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition flex items-center space-x-2 ${
                activeView === 'browse' || activeView === 'article'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <BookOpen size={18} />
              <span>Browse Articles</span>
            </button>
            <button
              onClick={() => setActiveView('ai-assistant')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition flex items-center space-x-2 ${
                activeView === 'ai-assistant'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Sparkles size={18} />
              <span>AI Coach Assistant</span>
            </button>
          </nav>
        </div>

        <div className="p-6">
          {activeView === 'browse' && (
            <BrowseView
              categories={categories}
              articles={filteredArticles}
              selectedCategory={selectedCategory}
              setSelectedCategory={setSelectedCategory}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              onArticleClick={handleArticleClick}
            />
          )}
          {activeView === 'article' && selectedArticle && (
            <ArticleView
              article={selectedArticle}
              onBack={() => setActiveView('browse')}
            />
          )}
          {activeView === 'ai-assistant' && (
            <AIAssistant userId={userId} />
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// BROWSE VIEW
// ============================================

function BrowseView({ categories, articles, selectedCategory, setSelectedCategory, searchQuery, setSearchQuery, onArticleClick }) {
  return (
    <div className="space-y-6">
      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
        <input
          type="text"
          placeholder="Search articles, tags, or topics..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Categories */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Categories</h3>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              !selectedCategory
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            All Articles
          </button>
          {categories.map(category => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                selectedCategory === category.id
                  ? `bg-${category.color}-600 text-white`
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {category.name}
            </button>
          ))}
        </div>
      </div>

      {/* Articles Grid */}
      {articles.length === 0 ? (
        <div className="text-center py-12">
          <BookOpen size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-600">No articles found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {articles.map(article => (
            <ArticleCard key={article.id} article={article} onClick={() => onArticleClick(article)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ArticleCard({ article, onClick }) {
  return (
    <div
      onClick={onClick}
      className="bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-lg transition cursor-pointer group"
    >
      {article.image_url && (
        <div className="h-48 overflow-hidden">
          <img
            src={article.image_url}
            alt={article.title}
            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
          />
        </div>
      )}
      <div className="p-4">
        {article.category && (
          <span className={`inline-block px-2 py-1 bg-${article.category.color}-100 text-${article.category.color}-700 rounded text-xs font-medium mb-2`}>
            {article.category.name}
          </span>
        )}
        <h3 className="font-semibold text-gray-900 mb-2 group-hover:text-blue-600 transition">
          {article.title}
        </h3>
        {article.summary && (
          <p className="text-sm text-gray-600 mb-3 line-clamp-2">{article.summary}</p>
        )}
        {article.tags && article.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {article.tags.slice(0, 3).map((tag, idx) => (
              <span key={idx} className="inline-flex items-center space-x-1 text-xs text-gray-500">
                <Tag size={12} />
                <span>{tag}</span>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center space-x-1">
            <Eye size={12} />
            <span>{article.view_count} views</span>
          </div>
          <div className="flex items-center space-x-1">
            <Calendar size={12} />
            <span>{new Date(article.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// ARTICLE VIEW
// ============================================

function ArticleView({ article, onBack }) {
  return (
    <div className="max-w-4xl mx-auto">
      <button
        onClick={onBack}
        className="flex items-center space-x-2 text-blue-600 hover:text-blue-800 mb-6"
      >
        <ArrowLeft size={18} />
        <span>Back to articles</span>
      </button>

      {article.image_url && (
        <div className="rounded-lg overflow-hidden mb-6">
          <img src={article.image_url} alt={article.title} className="w-full h-96 object-cover" />
        </div>
      )}

      <div className="bg-white rounded-lg shadow-lg p-8">
        {article.category && (
          <span className={`inline-block px-3 py-1 bg-${article.category.color}-100 text-${article.category.color}-700 rounded-full text-sm font-medium mb-4`}>
            {article.category.name}
          </span>
        )}

        <h1 className="text-4xl font-bold text-gray-900 mb-4">{article.title}</h1>

        {article.summary && (
          <p className="text-xl text-gray-600 mb-6">{article.summary}</p>
        )}

        <div className="flex items-center space-x-4 text-sm text-gray-500 mb-6 pb-6 border-b border-gray-200">
          {article.author && (
            <div className="flex items-center space-x-1">
              <UserIcon size={14} />
              <span>{article.author.full_name}</span>
            </div>
          )}
          <div className="flex items-center space-x-1">
            <Calendar size={14} />
            <span>{new Date(article.created_at).toLocaleDateString()}</span>
          </div>
          <div className="flex items-center space-x-1">
            <Eye size={14} />
            <span>{article.view_count} views</span>
          </div>
        </div>

        {/* Article Content (Markdown) */}
        <div className="prose prose-lg max-w-none mb-8">
          <div className="whitespace-pre-wrap">{article.content}</div>
        </div>

        {article.video_url && (
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Video Tutorial</h3>
            <div className="aspect-w-16 aspect-h-9 bg-gray-100 rounded-lg overflow-hidden">
              <iframe
                src={article.video_url}
                title={article.title}
                className="w-full h-96"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        )}

        {article.tags && article.tags.length > 0 && (
          <div className="pt-6 border-t border-gray-200">
            <div className="flex flex-wrap gap-2">
              {article.tags.map((tag, idx) => (
                <span key={idx} className="inline-flex items-center space-x-1 px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm">
                  <Tag size={14} />
                  <span>{tag}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// AI ASSISTANT
// ============================================

function AIAssistant({ userId }) {
  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(true);

  useEffect(() => {
    fetchConversations();
  }, [userId]);

  useEffect(() => {
    if (activeConversation) {
      fetchMessages(activeConversation);
    }
  }, [activeConversation]);

  const fetchConversations = async () => {
    const { data } = await supabase
      .from('ai_conversations')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    
    if (data) {
      setConversations(data);
      if (data.length > 0 && !activeConversation) {
        setActiveConversation(data[0].id);
      }
    }
    setLoadingConversations(false);
  };

  const fetchMessages = async (conversationId) => {
    const { data } = await supabase
      .from('ai_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    
    if (data) setMessages(data);
  };

  const handleNewConversation = async () => {
    const { data } = await supabase
      .from('ai_conversations')
      .insert({ user_id: userId })
      .select()
      .single();
    
    if (data) {
      setConversations([data, ...conversations]);
      setActiveConversation(data.id);
      setMessages([]);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = input.trim();
    setInput('');
    setLoading(true);

    try {
      // Create conversation if needed
      let convId = activeConversation;
      if (!convId) {
        const { data } = await supabase
          .from('ai_conversations')
          .insert({ user_id: userId })
          .select()
          .single();
        convId = data.id;
        setActiveConversation(convId);
        setConversations([data, ...conversations]);
      }

      // Save user message
      const { data: userMsg } = await supabase
        .from('ai_messages')
        .insert({
          conversation_id: convId,
          role: 'user',
          content: userMessage
        })
        .select()
        .single();

      setMessages([...messages, userMsg]);

      // Call AI API (you'll need to implement this endpoint)
      const response = await fetch('/api/ai-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: convId,
          message: userMessage
        })
      });

      const { reply } = await response.json();

      // Save assistant message
      const { data: assistantMsg } = await supabase
        .from('ai_messages')
        .insert({
          conversation_id: convId,
          role: 'assistant',
          content: reply
        })
        .select()
        .single();

      setMessages(prev => [...prev, assistantMsg]);

      // Update conversation title if first message
      if (messages.length === 0) {
        await supabase
          .from('ai_conversations')
          .update({ title: userMessage.substring(0, 50) })
          .eq('id', convId);
      }

    } catch (error) {
      console.error('AI Assistant error:', error);
      alert('Failed to get response from AI assistant');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-[600px] border border-gray-200 rounded-lg overflow-hidden">
      {/* Conversations Sidebar */}
      <div className="w-64 bg-gray-50 border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <button
            onClick={handleNewConversation}
            className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition flex items-center justify-center space-x-2"
          >
            <Plus size={18} />
            <span>New Chat</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingConversations ? (
            <div className="p-4 text-center text-gray-500">Loading...</div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              <MessageCircle size={32} className="mx-auto mb-2 text-gray-300" />
              <p className="text-sm">No conversations yet</p>
            </div>
          ) : (
            conversations.map(conv => (
              <button
                key={conv.id}
                onClick={() => setActiveConversation(conv.id)}
                className={`w-full text-left p-4 hover:bg-gray-100 transition ${
                  activeConversation === conv.id ? 'bg-gray-100 border-l-4 border-blue-600' : ''
                }`}
              >
                <p className="text-sm font-medium text-gray-900 truncate">
                  {conv.title || 'New conversation'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {new Date(conv.updated_at).toLocaleDateString()}
                </p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 ? (
            <div className="text-center py-12">
              <Sparkles size={48} className="mx-auto text-blue-400 mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">AI Coach Assistant</h3>
              <p className="text-gray-600 mb-4">Ask me anything about baseball training, technique, or strategy!</p>
              <div className="max-w-md mx-auto text-left space-y-2">
                <p className="text-sm text-gray-600"><strong>Example questions:</strong></p>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• How can I improve my swing mechanics?</li>
                  <li>• What are good drills for pitching accuracy?</li>
                  <li>• How should I approach hitting a curveball?</li>
                  <li>• What's the best way to strengthen my throwing arm?</li>
                </ul>
              </div>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[70%] rounded-lg px-4 py-3 ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-900'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ))
          )}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-lg px-4 py-3 flex items-center space-x-2">
                <Loader size={16} className="animate-spin text-gray-600" />
                <span className="text-sm text-gray-600">Thinking...</span>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <form onSubmit={handleSendMessage} className="p-4 border-t border-gray-200">
          <div className="flex space-x-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask your baseball question..."
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 flex items-center space-x-2"
            >
              <Send size={18} />
              <span>Send</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
