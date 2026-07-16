import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { BookOpen, Search, MessageCircle, Plus, Eye, Tag, Calendar, User as UserIcon, Send, Loader, Sparkles, ArrowLeft, MapPin } from 'lucide-react';

const EMBED_HOST_ALLOWLIST = new Set([
  'www.youtube.com',
  'youtube.com',
  'www.youtube-nocookie.com',
  'youtube-nocookie.com',
  'player.vimeo.com',
  'vimeo.com',
  'www.loom.com',
  'loom.com',
]);

// Tailwind only keeps class names it can see as complete literal strings, so
// interpolating `bg-${color}-600` gets purged and renders colorless. Map each
// category color to full static class strings instead.
const CATEGORY_COLORS = {
  red: { solid: 'bg-red-600 text-white', soft: 'bg-red-100 text-red-700' },
  orange: { solid: 'bg-orange-600 text-white', soft: 'bg-orange-100 text-orange-700' },
  amber: { solid: 'bg-amber-600 text-white', soft: 'bg-amber-100 text-amber-700' },
  yellow: { solid: 'bg-yellow-600 text-white', soft: 'bg-yellow-100 text-yellow-700' },
  green: { solid: 'bg-green-600 text-white', soft: 'bg-green-100 text-green-700' },
  teal: { solid: 'bg-teal-600 text-white', soft: 'bg-teal-100 text-teal-700' },
  blue: { solid: 'bg-blue-600 text-white', soft: 'bg-blue-100 text-blue-700' },
  indigo: { solid: 'bg-indigo-600 text-white', soft: 'bg-indigo-100 text-indigo-700' },
  purple: { solid: 'bg-purple-600 text-white', soft: 'bg-purple-100 text-purple-700' },
  pink: { solid: 'bg-pink-600 text-white', soft: 'bg-pink-100 text-pink-700' },
  gray: { solid: 'bg-gray-600 text-white', soft: 'bg-gray-100 text-gray-700' },
};
const catColor = (color) => CATEGORY_COLORS[color] || CATEGORY_COLORS.gray;

function toSafeEmbedUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:') return null;
    if (!EMBED_HOST_ALLOWLIST.has(u.host.toLowerCase())) return null;
    // Coerce common share URLs into their embed equivalents
    if (u.host.endsWith('youtube.com') && u.pathname === '/watch') {
      const id = u.searchParams.get('v');
      if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
      return `https://www.youtube-nocookie.com/embed/${id}`;
    }
    if (u.host === 'youtu.be') return null;
    if (u.host.endsWith('vimeo.com') && u.host !== 'player.vimeo.com') {
      const id = u.pathname.replace(/^\/+/, '').split('/')[0];
      if (!/^\d{5,12}$/.test(id)) return null;
      return `https://player.vimeo.com/video/${id}`;
    }
    return u.toString();
  } catch {
    return null;
  }
}

export default function KnowledgeBase({ userId, userRole }) {
  const [activeView, setActiveView] = useState('browse'); // browse, article, ai-assistant, situational
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
      .update({ view_count: (article.view_count || 0) + 1 })
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
            <button
              onClick={() => setActiveView('situational')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition flex items-center space-x-2 ${
                activeView === 'situational'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <MapPin size={18} />
              <span>Situational</span>
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
          {activeView === 'situational' && (
            <SituationalView />
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// SITUATIONAL VIEW (#225)
// ============================================
// Athletes pick their position and see common in-game situations and where to
// go / what to do. Content lives in the situational_plays table (seeded with
// standard baseball content; staff can edit the rows).

// Static pseudo-positions appended to the picker after the nine on-field
// positions. Their content (universal charts, prose, special team plays) is
// canonical and never edited, so it lives in the component, not the DB (#240).
const STATIC_POSITIONS = [
  { code: 'GEN', label: 'General' },
  { code: 'TEAM', label: 'Team Plays' },
];

function SituationalView() {
  const [plays, setPlays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activePosition, setActivePosition] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('situational_plays')
        .select('*')
        .order('position_order')
        .order('sort_order');
      if (cancelled) return;
      const rows = data || [];
      setPlays(rows);
      setActivePosition(rows.length ? rows[0].position_code : 'GEN');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Distinct on-field positions in picker order, then the static pseudo-tabs.
  const positions = [];
  const seen = new Set();
  plays.forEach(p => {
    if (!seen.has(p.position_code)) {
      seen.add(p.position_code);
      positions.push({ code: p.position_code, label: p.position_label });
    }
  });
  STATIC_POSITIONS.forEach(p => { if (!seen.has(p.code)) positions.push(p); });

  const isStatic = activePosition === 'GEN' || activePosition === 'TEAM';
  const activePlays = plays.filter(p => p.position_code === activePosition);
  const activeLabel = positions.find(p => p.code === activePosition)?.label;

  // Group the active position's situations by base state, preserving the order
  // they arrive in (rows come pre-sorted by sort_order).
  const groups = [];
  const groupIndex = {};
  activePlays.forEach(play => {
    const key = play.group_label || 'General';
    if (groupIndex[key] === undefined) {
      groupIndex[key] = groups.length;
      groups.push({ label: key, items: [] });
    }
    groups[groupIndex[key]].items.push(play);
  });

  if (loading) {
    return <p className="text-gray-500">Loading situational guide…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Situational Guide</h3>
        <p className="text-sm text-gray-600 mt-1">
          Pick your position to see common game situations and exactly where to go and what to do.
          Nine players have a job on every pitch — fielding, covering, backing up, or lining up a cutoff.
        </p>
      </div>

      {/* Position picker */}
      <div className="flex flex-wrap gap-2">
        {positions.map(pos => (
          <button
            key={pos.code}
            onClick={() => setActivePosition(pos.code)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition border ${
              activePosition === pos.code
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            <span className="font-semibold">{pos.code}</span>
            <span className="hidden sm:inline"> · {pos.label}</span>
          </button>
        ))}
      </div>

      {/* Content for the selected position */}
      {activePosition === 'GEN' && <GeneralView />}
      {activePosition === 'TEAM' && <TeamPlaysView />}
      {!isStatic && (
        <div>
          <h4 className="text-base font-bold text-gray-900 mb-3">{activeLabel}</h4>
          {activePlays.length === 0 ? (
            <p className="text-gray-500">No situational content yet.</p>
          ) : (
            <div className="space-y-6">
              {groups.map(group => (
                <div key={group.label}>
                  <div className="text-xs font-bold uppercase tracking-wide text-blue-700 mb-2">
                    {group.label}
                  </div>
                  <div className="space-y-3">
                    {group.items.map((play, i) => (
                      <div key={play.id} className="bg-white border border-gray-200 rounded-lg p-4">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 shrink-0 w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">
                            {i + 1}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-gray-900">{play.situation}</div>
                            <div className="text-sm text-gray-600 mt-1">{play.responsibility}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Shared responsive table shell for the reference charts.
function RefTable({ headers, rows }) {
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            {headers.map(h => (
              <th key={h} className="text-left font-semibold text-gray-700 px-3 py-2 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-gray-700">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// GENERAL: the universal rule, cutoff/relay + backup + depth charts, and the
// three run-saving rules. Static reference content (#240).
function GeneralView() {
  return (
    <div className="space-y-8">
      {/* The Universal Rule */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="font-bold text-gray-900 mb-2">The Universal Rule — before every pitch, ask three questions</div>
        <ol className="list-decimal list-inside text-sm text-gray-700 space-y-1">
          <li>How many outs? What's the count? What's the score and inning?</li>
          <li>Where are the runners, and how fast are they?</li>
          <li>What do I do if the ball comes to me — hard, soft, in the air, in the gap?</li>
        </ol>
        <p className="text-sm text-gray-600 mt-2">
          If you're not fielding the ball, you are covering a base, backing up a base, serving as a cutoff/relay,
          or directing traffic. There is no such thing as "standing there."
        </p>
      </div>

      {/* Cutoff & Relay */}
      <div>
        <h4 className="text-base font-bold text-gray-900 mb-3">Cutoff &amp; Relay Assignments</h4>
        <RefTable
          headers={['Play', 'Cutoff / Relay', 'Who covers the base']}
          rows={[
            ['Throw to 2nd (any outfielder)', 'Ball usually goes direct; pitcher trails as needed', 'SS or 2B (whoever isn’t the relay)'],
            ['Throw to 3rd (any outfielder)', 'Shortstop goes out as cutoff', '3B stays at the bag'],
            ['Throw home from LF', 'Third baseman', 'SS covers 3rd'],
            ['Throw home from CF / RF', 'First baseman', '3B covers 3rd'],
            ['Extra-base hit, LF / LC gap', 'SS is relay; 2B trails behind him', '2B covers 2nd if no relay needed'],
            ['Extra-base hit, RF / RC gap', '2B is relay; SS trails behind him', 'SS covers 2nd if no relay needed'],
          ]}
        />
        <p className="text-sm text-gray-600 mt-2">
          <span className="font-semibold">Common simplification:</span> many programs make the 1st baseman the cutoff on
          all throws home, keeping the 3rd baseman anchored at the bag. Pick one system and drill it — mixing them is how runs score.
        </p>
        <p className="text-sm text-gray-600 mt-2">
          <span className="font-semibold">Mechanics:</span> line up directly between the outfielder and the base, ~45–60 ft in front of the target.
          Hands high, yell so the outfielder finds you. The receiver makes the call — "Cut!" (cut and hold),
          "Cut two/three/four!" (cut and throw; 4 = home), or silence = let it through.
        </p>
      </div>

      {/* Backup Assignments */}
      <div>
        <h4 className="text-base font-bold text-gray-900 mb-3">Backup Assignments</h4>
        <RefTable
          headers={['Throw going to…', 'Backed up by']}
          rows={[
            ['1st base (infield throw, pickoff)', 'Right fielder, always. Also 2B on throws he’s not part of.'],
            ['2nd base (catcher on a steal, pitcher pickoff)', 'Center fielder'],
            ['2nd base (throw from the right side / RF)', 'Left fielder'],
            ['2nd base (throw from the left side / LF)', 'Right fielder'],
            ['3rd base', 'Left fielder, plus pitcher on throws from the outfield'],
            ['Home plate', 'Pitcher'],
            ['Ball in the gap', 'Nearest outfielder + the middle infielder trailing the relay'],
          ]}
        />
      </div>

      {/* Fly Ball Priority */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <div className="font-bold text-gray-900 mb-1">Fly Ball Priority (call it loud, call it three times)</div>
        <div className="text-sm font-mono text-gray-800">CF &gt; LF/RF &gt; SS/2B &gt; 3B/1B &gt; P/C</div>
        <p className="text-sm text-gray-600 mt-2">
          Outfielders beat infielders. Center field beats everybody. The player with priority calls "Ball! Ball! Ball!"
          and everyone else peels off and yells "Take it!" Nobody goes silent.
        </p>
      </div>

      {/* Defensive Depths */}
      <div>
        <h4 className="text-base font-bold text-gray-900 mb-3">Defensive Depths</h4>
        <RefTable
          headers={['Situation', 'Infield', 'Outfield']}
          rows={[
            ['Nobody on, early innings', 'Normal', 'Normal'],
            ['Runner on 1st, < 2 outs', 'Double-play depth (2 in, 2 toward the bag)', 'Normal'],
            ['Runner on 3rd, < 2 outs, run matters', 'In (on the grass)', 'Shallow enough to throw home'],
            ['Runner on 3rd, 2 outs', 'Normal — take the out at 1st', 'Normal'],
            ['Bunt likely', 'Corners in', 'Normal'],
            ['Late innings, protecting a lead', 'Guard the lines (1B and 3B)', 'No-doubles — deep and toward the lines'],
          ]}
        />
      </div>

      {/* Three Rules */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="font-bold text-gray-900 mb-2">The three rules that prevent more runs than anything else</div>
        <ol className="list-decimal list-inside text-sm text-gray-700 space-y-1">
          <li><span className="font-semibold">Hit the cutoff man.</span> A throw that reaches the cutoff stops the trail runner. Over his head is two extra bases.</li>
          <li><span className="font-semibold">Back up the base.</span> Every throw has a backup. Every one. Overthrows with no backup are free runs.</li>
          <li><span className="font-semibold">Take the sure out.</span> The lead runner is nice; the out is the point. A forced throw into the outfield turns one runner into two.</li>
        </ol>
      </div>
    </div>
  );
}

// TEAM PLAYS: special situations that involve the whole defense. Static (#240).
function TeamPlaysView() {
  const play = (title, body) => (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="font-bold text-gray-900 mb-1">{title}</div>
      {body}
    </div>
  );
  return (
    <div className="space-y-4">
      {play('Rundown (Pickle)', (
        <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
          <li>Run the runner back toward the base he came from. Never let him advance.</li>
          <li>Minimize throws — ideally one. Sprint at him with the ball held high, make him commit.</li>
          <li>The receiving fielder gives a target off the base line so nobody gets hit.</li>
          <li>Everybody has a base: after you throw, peel off behind the fielder you threw to and get in line at the other end.</li>
          <li>Trap him — don't chase him forever.</li>
        </ul>
      ))}
      {play('First & Third (runner on 1st takes off)', (
        <div className="text-sm text-gray-700 space-y-1">
          <p>Every team has a call. The three basic options:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li><span className="font-semibold">Throw through to 2nd</span> — take the out, concede the run if the runner on 3rd breaks. Fine if the run doesn't matter.</li>
            <li><span className="font-semibold">Cut the throw</span> — a middle infielder cuts it in front of the bag, then looks the runner at 3rd back or throws home.</li>
            <li><span className="font-semibold">Fake / hold</span> — catcher fakes or throws back to the pitcher; everybody looks the runner at 3rd back. Concede second, protect the run.</li>
          </ol>
          <p className="text-gray-600">Whatever the call, the pitcher, catcher, SS, and 2B must all know it before the pitch.</p>
        </div>
      ))}
      {play('Infield Fly Rule', (
        <p className="text-sm text-gray-700">
          Runners on 1st &amp; 2nd (or bases loaded) with less than two outs, on an infield pop-up catchable with ordinary effort:
          the batter is out automatically. The umpire calls it. Catch it anyway — but don't intentionally drop it for a cheap double play. It won't work.
        </p>
      ))}
      {play('Tag-Ups', (
        <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
          <li>Runner on 3rd, fly ball, less than 2 outs: the outfielder is throwing home; the 3B or cutoff man lines it up.</li>
          <li>Foul-ball catch with a runner on 3rd: know how deep you're going. If the catch lets the run score and you're behind, it may not be worth it.</li>
        </ul>
      ))}
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
                  ? catColor(category.color).solid
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
          <span className={`inline-block px-2 py-1 ${catColor(article.category.color).soft} rounded text-xs font-medium mb-2`}>
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
          <span className={`inline-block px-3 py-1 ${catColor(article.category.color).soft} rounded-full text-sm font-medium mb-4`}>
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

        {(() => {
          const safeEmbed = toSafeEmbedUrl(article.video_url);
          if (!safeEmbed) {
            if (article.video_url) {
              return (
                <div className="mb-8 text-sm text-gray-500">
                  Video link is not from a supported host — open it manually:{' '}
                  <a
                    href={article.video_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-blue-600 underline break-all"
                  >
                    {article.video_url}
                  </a>
                </div>
              );
            }
            return null;
          }
          return (
            <div className="mb-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Video Tutorial</h3>
              <div className="aspect-w-16 aspect-h-9 bg-gray-100 rounded-lg overflow-hidden">
                <iframe
                  src={safeEmbed}
                  title={article.title}
                  className="w-full h-96"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </div>
          );
        })()}

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
        const { data, error: convErr } = await supabase
          .from('ai_conversations')
          .insert({ user_id: userId })
          .select()
          .single();
        if (convErr || !data) throw convErr || new Error('Failed to start conversation');
        convId = data.id;
        setActiveConversation(convId);
        setConversations([data, ...conversations]);
      }

      // Save user message
      const { data: userMsg, error: userMsgErr } = await supabase
        .from('ai_messages')
        .insert({
          conversation_id: convId,
          role: 'user',
          content: userMessage
        })
        .select()
        .single();
      if (userMsgErr || !userMsg) throw userMsgErr || new Error('Failed to save message');

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

      if (!response.ok) throw new Error(`AI assistant returned ${response.status}`);
      const { reply } = await response.json();
      if (!reply) throw new Error('AI assistant returned an empty reply');

      // Save assistant message
      const { data: assistantMsg, error: assistantErr } = await supabase
        .from('ai_messages')
        .insert({
          conversation_id: convId,
          role: 'assistant',
          content: reply
        })
        .select()
        .single();
      if (assistantErr || !assistantMsg) throw assistantErr || new Error('Failed to save reply');

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
