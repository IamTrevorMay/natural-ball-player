import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { fetchUserDirectory } from './userDirectory';
import { formatUserError } from './errorMessage';
import { BookOpen, Search, MessageCircle, Plus, Eye, Tag, Calendar, User as UserIcon, Send, Loader, Sparkles, ArrowLeft, MapPin, Play, Pencil, X, ExternalLink, AlertTriangle } from 'lucide-react';

// Hosts we will accept a pasted link *from*. Being on this list is necessary
// but not sufficient — every host below has an explicit coercion branch in
// toSafeEmbedUrl(), and anything that does not match one of those shapes is
// rejected. `youtu.be` is an input-only host: YouTube's own Share button hands
// out youtu.be links, but they cannot be framed, so they are always converted.
const EMBED_HOST_ALLOWLIST = new Set([
  'www.youtube.com',
  'youtube.com',
  'www.youtube-nocookie.com',
  'youtube-nocookie.com',
  'youtu.be',
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
  blue: { solid: 'bg-sky-600 text-white', soft: 'bg-sky-100 text-sky-700' },
  indigo: { solid: 'bg-violet-600 text-white', soft: 'bg-violet-100 text-violet-700' },
  purple: { solid: 'bg-purple-600 text-white', soft: 'bg-purple-100 text-purple-700' },
  pink: { solid: 'bg-pink-600 text-white', soft: 'bg-pink-100 text-pink-700' },
  gray: { solid: 'bg-gray-600 text-white', soft: 'bg-gray-100 text-gray-700' },
};
const catColor = (color) => CATEGORY_COLORS[color] || CATEGORY_COLORS.gray;

// #274: a link that passes validation but cannot be framed is worse than a
// rejected one — it saves cleanly, then renders a blank/refused iframe that
// nobody notices for months. So there is no fall-through here: every accepted
// host is coerced into a known-embeddable URL, and everything else is null.

const YOUTUBE_ID_RE = /^[\w-]{6,20}$/;
const VIMEO_ID_RE = /^\d{5,12}$/;
const VIMEO_HASH_RE = /^[A-Za-z0-9]{6,20}$/;
const LOOM_ID_RE = /^[A-Za-z0-9]{8,64}$/;

// Accepts YouTube's timestamp forms: `123`, `90s`, `1m30s`, `1h2m3s`.
function parseStartSeconds(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  if (/^\d+$/.test(v)) {
    const n = parseInt(v, 10);
    return n > 0 ? n : null;
  }
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  const total = parseInt(m[1] || '0', 10) * 3600 + parseInt(m[2] || '0', 10) * 60 + parseInt(m[3] || '0', 10);
  return total > 0 ? total : null;
}

function youTubeEmbed(id, startSeconds) {
  if (!id || !YOUTUBE_ID_RE.test(id)) return null;
  const base = `https://www.youtube-nocookie.com/embed/${id}`;
  return startSeconds ? `${base}?start=${startSeconds}` : base;
}

// Parses + allowlists, or returns null. Shared by toSafeEmbedUrl and the
// "open it yourself" anchors so a raw href can never reach the DOM.
function parseAllowedUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (!EMBED_HOST_ALLOWLIST.has(u.host.toLowerCase())) return null;
  return u;
}

function toSafeEmbedUrl(raw) {
  const u = parseAllowedUrl(raw);
  if (!u) return null;
  const host = u.host.toLowerCase();
  const segments = u.pathname.split('/').filter(Boolean);
  const start = parseStartSeconds(u.searchParams.get('t') || u.searchParams.get('start'));

  // youtu.be/ID — the Share-button form. Input only; never framed directly.
  if (host === 'youtu.be') {
    if (segments.length !== 1) return null;
    return youTubeEmbed(segments[0], start);
  }

  // youtube.com and youtube-nocookie.com: /watch?v=ID, /shorts/ID, /live/ID,
  // /embed/ID. Everything else (playlists, channels, /results, bare /) is out.
  if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    if (u.pathname === '/watch') return youTubeEmbed(u.searchParams.get('v'), start);
    if (segments.length === 2 && (segments[0] === 'shorts' || segments[0] === 'live' || segments[0] === 'embed')) {
      return youTubeEmbed(segments[1], start);
    }
    return null;
  }

  // player.vimeo.com/video/ID — already an embed URL. The `h` param is the
  // unlisted-video token, so it has to survive.
  if (host === 'player.vimeo.com') {
    if (segments.length !== 2 || segments[0] !== 'video' || !VIMEO_ID_RE.test(segments[1])) return null;
    const h = u.searchParams.get('h');
    return h && VIMEO_HASH_RE.test(h)
      ? `https://player.vimeo.com/video/${segments[1]}?h=${h}`
      : `https://player.vimeo.com/video/${segments[1]}`;
  }

  // vimeo.com/ID, or vimeo.com/ID/HASH for an unlisted video.
  if (host === 'vimeo.com') {
    if (!segments.length || !VIMEO_ID_RE.test(segments[0])) return null;
    if (segments.length === 1) return `https://player.vimeo.com/video/${segments[0]}`;
    if (segments.length === 2 && VIMEO_HASH_RE.test(segments[1])) {
      return `https://player.vimeo.com/video/${segments[0]}?h=${segments[1]}`;
    }
    return null;
  }

  // loom.com/share/ID (the Share-button form) and loom.com/embed/ID.
  if (host === 'loom.com' || host === 'www.loom.com') {
    if (segments.length !== 2) return null;
    if (segments[0] !== 'share' && segments[0] !== 'embed') return null;
    if (!LOOM_ID_RE.test(segments[1])) return null;
    return `https://www.loom.com/embed/${segments[1]}`;
  }

  return null;
}

// An href we are willing to put in the DOM: https, allowlisted host, nothing
// else. Used for the "open it yourself" fallback links, which do not need the
// URL to be *embeddable* — only safe.
function toSafeExternalUrl(raw) {
  const u = parseAllowedUrl(raw);
  return u ? u.toString() : null;
}

// "Open in YouTube" reads wrong on a Vimeo link, and the fallback link is now
// shown for hosts other than YouTube.
function externalLinkLabel(raw) {
  const u = parseAllowedUrl(raw);
  if (!u) return 'Open video link';
  const host = u.host.toLowerCase();
  if (host.endsWith('vimeo.com')) return 'Open in Vimeo';
  if (host.endsWith('loom.com')) return 'Open in Loom';
  return 'Open in YouTube';
}

// Names what is actually wrong with a pasted link, for a single save-time
// alert(). (No modal: this project has a history of modals putting their own
// buttons off-screen.)
const ACCEPTED_FORMS_HINT =
  'Accepted: youtube.com/watch?v=…, youtu.be/…, youtube.com/shorts/… or /live/…, vimeo.com/123456789, or loom.com/share/… .';

function describeVideoUrlProblem(raw) {
  const trimmed = (raw || '').trim();
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    return `That doesn't look like a web address. ${ACCEPTED_FORMS_HINT}`;
  }
  if (u.protocol !== 'https:') {
    return `Only https links can be embedded — this one starts with "${u.protocol}//". ${ACCEPTED_FORMS_HINT}`;
  }
  if (!EMBED_HOST_ALLOWLIST.has(u.host.toLowerCase())) {
    return `${u.host} isn't a supported video host — only YouTube, Vimeo and Loom links can be embedded. ${ACCEPTED_FORMS_HINT}`;
  }
  return `That ${u.host} link isn't a form we can embed — playlists, channel pages, search results and "members only" links won't play here. ${ACCEPTED_FORMS_HINT}`;
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
    const { data, error } = await supabase
      .from('knowledge_articles')
      .select(`
        *,
        category:category_id(name, color)
      `)
      .eq('is_published', true)
      .order('created_at', { ascending: false });
    if (error) { console.error('fetchArticles failed:', error); return; }
    // The author byline used to be an embed on `users`. A blocked embed returns
    // author: null with no error, so the byline would just quietly vanish from
    // every article. Same object shape, so the render below is untouched.
    const authors = await fetchUserDirectory((data || []).map(a => a.author_id));
    setArticles((data || []).map(a => ({ ...a, author: authors.get(a.author_id) || null })));
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
            // There is no way to add an article yet — no form, and nothing in
            // the app writes to knowledge_articles. The button stays visible
            // but disabled so it stops promising something it cannot do.
            <button
              type="button"
              disabled
              title="Articles cannot be added in the portal yet."
              className="bg-gray-200 text-gray-500 px-4 py-2 rounded-lg font-medium flex items-center space-x-2 cursor-not-allowed"
            >
              <Plus size={18} />
              <span>Add Article (not available yet)</span>
            </button>
          )}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-white rounded-lg shadow">
        <div className="border-b border-gray-200">
          {/* F1: was "flex space-x-8 px-6" — no wrap and no scroller, so the
              third tab ran past a 390px viewport and panned the whole page
              (same class as #321). Wraps now, matching the Situational position
              picker below. gap-x-8 spaces identically to space-x-8 when the row
              does not wrap, so wide screens are unchanged. */}
          <nav className="flex flex-wrap gap-x-8 px-4 sm:px-6">
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
            <SituationalView userRole={userRole} />
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

// #372: General and Team Plays are hardcoded JSX, so their sections have no
// database id to key a video to. Each section instead gets a stable string key
// below, stored in situational_plays.static_key. The key is deliberately NOT
// derived from the heading text, so rewording the prose never orphans a video.
// A row carrying a static_key is a video slot, never a situation in the picker.
// The key is the stable identifier; the title is display copy that must match
// the heading on screen (F3), since it is written to the row's situation column
// and used as the iframe title.
const STATIC_VIDEO_ROW_NOTE = 'Example video slot for the static Situational guide (#372).';

// The third column is the link Cordell supplied for that section. It is a
// DEFAULT, not a fixture: the app shows it when the slot has no row of its own,
// so the videos appear the moment this code deploys, with no migration and no
// hand-pasting. The alternative — seeding INSERTs in the migration — would have
// left the slots empty on any environment where the migration had not been run
// yet, which is every environment until someone runs it.
//
// A staff edit still wins, always. Saving a link writes a row for that
// static_key and the row is read in preference to this table; clearing a link
// writes a row with a NULL video_url, which reads as a deliberate "no video"
// and suppresses the default. So a default can be replaced or removed from the
// pencil like any other slot, and the only way back to the default is to delete
// that row in the database.
//
// gen-three-rules is deliberately null: Cordell sent nine links for ten slots
// and did not send one for it. It renders as an empty slot, exactly as designed,
// and nothing is substituted or guessed.
const STATIC_VIDEO_SLOTS = {};
[
  ['GEN', 'General', [
    ['gen-universal-rule', 'The Universal Rule — before every pitch, ask three questions', 'https://youtube.com/shorts/bocNmloGFRI'],
    ['gen-cutoff-relay', 'Cutoff & Relay Assignments', 'https://youtu.be/wIU9NdCBBkE'],
    ['gen-backup-assignments', 'Backup Assignments', 'https://youtu.be/LD4H96mlpr8'],
    ['gen-fly-ball-priority', 'Fly Ball Priority (call it loud, call it three times)', 'https://youtu.be/R6qzZfN2IQE'],
    ['gen-defensive-depths', 'Defensive Depths', 'https://youtu.be/lis5N4-KwWk'],
    ['gen-three-rules', 'The three rules that prevent more runs than anything else', null],
  ]],
  ['TEAM', 'Team Plays', [
    ['team-rundown', 'Rundown (Pickle)', 'https://youtu.be/OEYEvKRh2eQ'],
    ['team-first-and-third', 'First & Third (runner on 1st takes off)', 'https://youtu.be/UDgDJSEOves'],
    ['team-infield-fly', 'Infield Fly Rule', 'https://youtu.be/8DuNMudFst8'],
    ['team-tag-ups', 'Tag-Ups', 'https://youtu.be/vjoIcUIgv5o'],
  ]],
].forEach(([positionCode, positionLabel, slots]) => {
  slots.forEach(([key, title, defaultVideoUrl = null], i) => {
    STATIC_VIDEO_SLOTS[key] = { key, title, positionCode, positionLabel, sortOrder: i, defaultVideoUrl };
  });
});

// The link a static slot should show right now: its own row if one exists —
// including a row whose video_url is NULL, which means staff cleared it — and
// otherwise the default above. `rows` is keyed by static_key.
function staticSlotVideoUrl(rows, slotKey) {
  const slot = STATIC_VIDEO_SLOTS[slotKey];
  if (!slot) return null;
  const row = rows[slotKey];
  if (row) return row.video_url || null;
  return slot.defaultVideoUrl || null;
}

// #372: the staff-only pencil that opens the video-link editor. Extracted so the
// database-backed position plays and the static slots use one implementation.
function VideoEditPencil({ isStaff, videoUrl, editing, onToggle, className = '' }) {
  if (!isStaff) return null;
  return (
    <button
      onClick={onToggle}
      className={`shrink-0 p-1 text-gray-300 hover:text-blue-600 transition ${className}`}
      title={videoUrl ? 'Edit example video link' : 'Add example video link'}
    >
      {editing ? <X size={13} /> : <Pencil size={13} />}
    </button>
  );
}

// #372: the video block itself — edit box, the #274 unembeddable warning, the
// "Watch example" toggle and the iframe. Previously inlined in the position-play
// map; now shared by that path and the static General / Team Plays slots so
// there is exactly one copy of the embed and save behaviour.
function SituationalVideoBody({ id, title, videoUrl, isStaff, ui, onSave }) {
  const embedUrl = toSafeEmbedUrl(videoUrl);
  // A stored link that is not embeddable used to render as nothing at all —
  // indistinguishable from "no video", which is how a dead link survives for
  // months (#274). Show the external link to everyone and tell staff to fix it.
  const externalUrl = toSafeExternalUrl(videoUrl);
  const unembeddable = !!videoUrl && !embedUrl;
  const videoOpen = ui.openVideoId === id;
  const editing = ui.editingVideoId === id;
  return (
    <>
      {editing && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="url"
            value={ui.videoDraft}
            onChange={(e) => ui.setVideoDraft(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className="flex-1 min-w-[160px] px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={onSave}
            disabled={ui.savingVideo}
            className="px-2.5 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 transition disabled:opacity-50"
          >
            {ui.savingVideo ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={() => ui.setEditingVideoId(null)}
            className="p-1.5 text-gray-400 hover:text-gray-600 transition"
            title="Cancel"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {unembeddable && !editing && (
        <div className="mt-2 space-y-1">
          {externalUrl && (
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 transition"
            >
              <ExternalLink size={12} />
              <span>{externalLinkLabel(videoUrl)}</span>
            </a>
          )}
          {isStaff && (
            <div className="flex items-start gap-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded px-2 py-1 text-[11px]">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>This link can't be embedded — click the pencil to replace it.</span>
            </div>
          )}
        </div>
      )}
      {embedUrl && !editing && (
        <button
          onClick={() => ui.setOpenVideoId(videoOpen ? null : id)}
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 transition"
        >
          <Play size={12} className={videoOpen ? 'rotate-90 transition-transform' : 'transition-transform'} />
          <span>{videoOpen ? 'Hide example' : 'Watch example'}</span>
        </button>
      )}
      {embedUrl && videoOpen && !editing && (
        <>
          <div className="mt-2 rounded-lg overflow-hidden border border-gray-200 relative" style={{ paddingBottom: '56.25%', height: 0 }}>
            <iframe
              src={embedUrl}
              title={`Example: ${title}`}
              className="absolute inset-0 w-full h-full"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
          {externalUrl && (
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-blue-600 transition"
            >
              <ExternalLink size={10} />
              {externalLinkLabel(videoUrl)}
            </a>
          )}
        </>
      )}
    </>
  );
}

function SituationalView({ userRole }) {
  const [plays, setPlays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activePosition, setActivePosition] = useState(null);
  const isStaff = userRole === 'admin' || userRole === 'coach';
  // Per-play video UI: which play's embed is open, which is being edited.
  const [openVideoId, setOpenVideoId] = useState(null);
  const [editingVideoId, setEditingVideoId] = useState(null);
  const [videoDraft, setVideoDraft] = useState('');
  const [savingVideo, setSavingVideo] = useState(false);
  // #372: video rows for the static GEN / TEAM sections, keyed by static_key.
  const [staticVideos, setStaticVideos] = useState({});

  // Shared handle for the video UI, so the position plays and the static slots
  // drive the same "only one open at a time" state they always have.
  const videoUi = {
    openVideoId, setOpenVideoId,
    editingVideoId, setEditingVideoId,
    videoDraft, setVideoDraft,
    savingVideo,
  };

  const saveVideoUrl = async (play) => {
    const raw = videoDraft.trim();
    if (raw && !toSafeEmbedUrl(raw)) {
      alert(describeVideoUrlProblem(raw));
      return;
    }
    setSavingVideo(true);
    const { error } = await supabase
      .from('situational_plays')
      .update({ video_url: raw || null })
      .eq('id', play.id);
    setSavingVideo(false);
    // F2: error.message here is the raw PostgREST string, which leaks column and
    // constraint names at the user. Same convention as Profile.js: log the real
    // error for a developer, show the translated one.
    if (error) {
      console.error('Error saving video link:', error);
      alert('Error saving video link: ' + formatUserError(error));
      return;
    }
    setPlays(prev => prev.map(p => (p.id === play.id ? { ...p, video_url: raw || null } : p)));
    setEditingVideoId(null);
    if (!raw && openVideoId === play.id) setOpenVideoId(null);
  };

  // #372: same validation and same table as saveVideoUrl above, but a static
  // slot may not have a row yet, so the first save inserts one. Both the insert
  // and the update run under the staff-only policies that already exist on
  // situational_plays — no new permission surface.
  const saveStaticVideoUrl = async (slot) => {
    const raw = videoDraft.trim();
    if (raw && !toSafeEmbedUrl(raw)) {
      alert(describeVideoUrlProblem(raw));
      return;
    }
    const existing = staticVideos[slot.key];
    // Clearing a slot that has neither a row NOR a default is a no-op — there is
    // nothing to clear, so don't write an empty row. Clearing a slot that is
    // showing its DEFAULT is not a no-op: it has to write a row with a NULL
    // video_url, because that row is what tells the app the staff member meant
    // "no video here" rather than "nobody has set one yet".
    if (!existing && !raw && !slot.defaultVideoUrl) { setEditingVideoId(null); return; }
    setSavingVideo(true);
    let error = null;
    if (existing) {
      ({ error } = await supabase
        .from('situational_plays')
        .update({ video_url: raw || null })
        .eq('id', existing.id));
      if (!error) {
        setStaticVideos(prev => ({ ...prev, [slot.key]: { ...prev[slot.key], video_url: raw || null } }));
      }
    } else {
      const { data, error: insertError } = await supabase
        .from('situational_plays')
        .insert({
          position_code: slot.positionCode,
          position_label: slot.positionLabel,
          position_order: 99,
          situation: slot.title,
          responsibility: STATIC_VIDEO_ROW_NOTE,
          sort_order: slot.sortOrder,
          static_key: slot.key,
          video_url: raw || null,
        })
        .select()
        .single();
      error = insertError;
      if (!error && data) setStaticVideos(prev => ({ ...prev, [slot.key]: data }));
    }
    setSavingVideo(false);
    if (error) {
      console.error('Error saving video link:', error);
      alert('Error saving video link: ' + formatUserError(error));
      return;
    }
    setEditingVideoId(null);
    if (!raw && openVideoId === slot.key) setOpenVideoId(null);
  };

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
      // #372: rows carrying a static_key are video slots for the hardcoded
      // GEN / TEAM sections, not situations. They are split out here so they can
      // never reach the picker, never override a position label or the default
      // tab, and never fall into the position list below.
      const playRows = rows.filter(r => !r.static_key);
      const staticRows = rows.filter(r => r.static_key);
      setPlays(playRows);
      const byKey = {};
      staticRows.forEach(r => { byKey[r.static_key] = r; });
      setStaticVideos(byKey);
      setActivePosition(playRows.length ? playRows[0].position_code : 'GEN');
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

  // #372: renders one static section's video affordance. A player with no video
  // set sees nothing at all — no empty box, no broken player.
  const renderStaticVideo = (slotKey) => {
    const slot = STATIC_VIDEO_SLOTS[slotKey];
    if (!slot) return null;
    const videoUrl = staticSlotVideoUrl(staticVideos, slot.key);
    if (!videoUrl && !isStaff) return null;
    const editing = editingVideoId === slot.key;
    return (
      <div className="mt-3 pt-2 border-t border-gray-200/70">
        <VideoEditPencil
          isStaff={isStaff}
          videoUrl={videoUrl}
          editing={editing}
          onToggle={() => {
            if (editing) { setEditingVideoId(null); return; }
            setEditingVideoId(slot.key);
            setVideoDraft(videoUrl || '');
          }}
          className="-ml-1"
        />
        <SituationalVideoBody
          id={slot.key}
          title={slot.title}
          videoUrl={videoUrl}
          isStaff={isStaff}
          ui={videoUi}
          onSave={() => saveStaticVideoUrl(slot)}
        />
      </div>
    );
  };

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
      {activePosition === 'GEN' && <GeneralView renderVideo={renderStaticVideo} />}
      {activePosition === 'TEAM' && <TeamPlaysView renderVideo={renderStaticVideo} />}
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
                    {group.items.map((play, i) => {
                      const editingVideo = editingVideoId === play.id;
                      return (
                        <div key={play.id} className="bg-white border border-gray-200 rounded-lg p-4">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 shrink-0 w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">
                              {i + 1}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <div className="font-semibold text-gray-900">{play.situation}</div>
                                <VideoEditPencil
                                  isStaff={isStaff}
                                  videoUrl={play.video_url}
                                  editing={editingVideo}
                                  onToggle={() => {
                                    if (editingVideo) { setEditingVideoId(null); return; }
                                    setEditingVideoId(play.id);
                                    setVideoDraft(play.video_url || '');
                                  }}
                                />
                              </div>
                              <div className="text-sm text-gray-600 mt-1">{play.responsibility}</div>
                              <SituationalVideoBody
                                id={play.id}
                                title={play.situation}
                                videoUrl={play.video_url}
                                isStaff={isStaff}
                                ui={videoUi}
                                onSave={() => saveVideoUrl(play)}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
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
function GeneralView({ renderVideo = () => null }) {
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
        {renderVideo('gen-universal-rule')}
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
        {renderVideo('gen-cutoff-relay')}
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
        {renderVideo('gen-backup-assignments')}
      </div>

      {/* Fly Ball Priority */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <div className="font-bold text-gray-900 mb-1">Fly Ball Priority (call it loud, call it three times)</div>
        <div className="text-sm font-mono text-gray-800">CF &gt; LF/RF &gt; SS/2B &gt; 3B/1B &gt; P/C</div>
        <p className="text-sm text-gray-600 mt-2">
          Outfielders beat infielders. Center field beats everybody. The player with priority calls "Ball! Ball! Ball!"
          and everyone else peels off and yells "Take it!" Nobody goes silent.
        </p>
        {renderVideo('gen-fly-ball-priority')}
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
        {renderVideo('gen-defensive-depths')}
      </div>

      {/* Three Rules */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="font-bold text-gray-900 mb-2">The three rules that prevent more runs than anything else</div>
        <ol className="list-decimal list-inside text-sm text-gray-700 space-y-1">
          <li><span className="font-semibold">Hit the cutoff man.</span> A throw that reaches the cutoff stops the trail runner. Over his head is two extra bases.</li>
          <li><span className="font-semibold">Back up the base.</span> Every throw has a backup. Every one. Overthrows with no backup are free runs.</li>
          <li><span className="font-semibold">Take the sure out.</span> The lead runner is nice; the out is the point. A forced throw into the outfield turns one runner into two.</li>
        </ol>
        {renderVideo('gen-three-rules')}
      </div>
    </div>
  );
}

// TEAM PLAYS: special situations that involve the whole defense. Static (#240).
function TeamPlaysView({ renderVideo = () => null }) {
  const play = (slotKey, title, body) => (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="font-bold text-gray-900 mb-1">{title}</div>
      {body}
      {renderVideo(slotKey)}
    </div>
  );
  return (
    <div className="space-y-4">
      {play('team-rundown', 'Rundown (Pickle)', (
        <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
          <li>Run the runner back toward the base he came from. Never let him advance.</li>
          <li>Minimize throws — ideally one. Sprint at him with the ball held high, make him commit.</li>
          <li>The receiving fielder gives a target off the base line so nobody gets hit.</li>
          <li>Everybody has a base: after you throw, peel off behind the fielder you threw to and get in line at the other end.</li>
          <li>Trap him — don't chase him forever.</li>
        </ul>
      ))}
      {play('team-first-and-third', 'First & Third (runner on 1st takes off)', (
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
      {play('team-infield-fly', 'Infield Fly Rule', (
        <p className="text-sm text-gray-700">
          Runners on 1st &amp; 2nd (or bases loaded) with less than two outs, on an infield pop-up catchable with ordinary effort:
          the batter is out automatically. The umpire calls it. Catch it anyway — but don't intentionally drop it for a cheap double play. It won't work.
        </p>
      ))}
      {play('team-tag-ups', 'Tag-Ups', (
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
              // Never put the raw stored value in an href — same bug class as
              // #274's situational anchor. If it is not https + allowlisted it
              // is shown as plain text, not as something clickable.
              const externalUrl = toSafeExternalUrl(article.video_url);
              return (
                <div className="mb-8 text-sm text-gray-500">
                  Video link is not from a supported host — open it manually:{' '}
                  {externalUrl ? (
                    <a
                      href={externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 underline break-all"
                    >
                      {article.video_url}
                    </a>
                  ) : (
                    <span className="break-all">{article.video_url}</span>
                  )}
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
    /* G1: this was "flex h-[600px] ... overflow-hidden" — a fixed 256px sidebar
       beside the chat with no responsive stacking. On a 390px phone the chat
       pane could not shrink (flex items default to min-width:auto), so it ran
       past the container and overflow-hidden clipped the Send button off-screen
       with no scrollbar and no pan: the assistant was unusable. The panes now
       stack below sm and sit side by side from sm up, with min-w-0 so the chat
       pane may actually shrink. overflow-hidden stays — removing it would just
       trade the dead button for a sideways-panning page (F1). */
    <div className="flex flex-col sm:flex-row h-[70vh] sm:h-[600px] border border-gray-200 rounded-lg overflow-hidden">
      {/* Conversations Sidebar — above the chat on a phone so "New Chat" and the
          conversation list stay in the same reading order as the desktop
          left-to-right, with no CSS order juggling. Capped so it cannot eat the
          whole screen; its list scrolls inside that cap.
          K3: the cap is max-h-40, not max-h-48. The extra 32px looked like more
          breathing room on a 844px-tall phone, but on a 480px one it came
          straight out of the chat, leaving a 59px message pane — about one
          bubble. The messages are the point of this screen, so they get the
          space and the conversation list scrolls. sm:max-h-none keeps the
          desktop layout untouched either way. */}
      <div className="w-full sm:w-64 flex-shrink-0 max-h-40 sm:max-h-none bg-gray-50 border-b sm:border-b-0 sm:border-r border-gray-200 flex flex-col">
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
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
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
              className="flex-1 min-w-0 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="flex-shrink-0 bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 flex items-center space-x-2"
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
