import React, { useState, useEffect } from 'react';
import { Download, Monitor, ChevronDown, ChevronRight, ExternalLink, AlertTriangle, RefreshCw } from 'lucide-react';

// Admin Settings → Downloads: every desktop tool staff can install, newest
// release first.
//
// Releases are GitHub Releases on the portal repo (public), one tag per tool
// version (`<tool>-v<semver>`), with the installer attached as an asset. The
// catalog below is the fixed, hand-written half: what each tool is, what it
// needs and how to install it. The live half (versions, dates, download
// links) is read from the GitHub API at open time, so cutting a new release
// with `gh release create` is all it takes for a new version to appear here —
// no portal deploy. If GitHub is unreachable, each tool falls back to the
// `latestKnown` release baked in at the last deploy so the button still works.
const REPO = 'IamTrevorMay/natural-ball-player';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=50`;

export const SOFTWARE_CATALOG = [
  {
    key: 'bullpensync',
    name: 'BullpenSync',
    tagline: 'Live Trackman B1 bullpen capture, straight into the athlete\'s profile.',
    description:
      'Runs on a coach\'s Mac next to the Trackman iPad. Pick an athlete, press Start Session, and every pitch appears in a live table as it is thrown. End Session saves a CSV on the laptop and uploads the session to the athlete\'s Trackman tab, tagged as a live capture alongside the nightly imports.',
    platform: 'macOS 12 or later, Intel or Apple Silicon',
    tagPrefix: 'bullpensync-v',
    assetName: 'BullpenSync.zip',
    latestKnown: { version: '1.0.1', tag: 'bullpensync-v1.0.1', publishedAt: '2026-10-07' },
    requirements: [
      'The iPad running the Trackman app, connected to the Mac by USB and trusted (tap Trust on the iPad the first time).',
      'A Mac admin password once, for the one-time setup wizard inside the app.',
      'Your NBP admin or coach login — the app signs in with it and writes under your account.',
    ],
    steps: [
      'Download BullpenSync.zip and unzip it.',
      'Drag BullpenSync.app into Applications.',
      'Double-click it. It is signed and notarized, so macOS only shows the usual "downloaded from the internet" prompt.',
      'In the setup wizard, click Fix permissions… and enter the Mac admin password. Log out and back in if the wizard asks.',
      'Plug in the iPad, tap Trust, sign in with your NBP account, pick an athlete and press Start Session.',
    ],
  },
];

function assetUrl(tag, assetName) {
  return `https://github.com/${REPO}/releases/download/${tag}/${assetName}`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// One release as the list shows it. Built from a GitHub release, or from the
// catalog's latestKnown when the API could not be reached.
function toEntry(tool, rel) {
  const asset = (rel.assets || []).find(a => a.name === tool.assetName) || (rel.assets || [])[0] || null;
  return {
    tag: rel.tag_name,
    version: rel.tag_name.slice(tool.tagPrefix.length),
    publishedAt: rel.published_at,
    notes: rel.body || '',
    url: asset ? asset.browser_download_url : assetUrl(rel.tag_name, tool.assetName),
    size: asset ? asset.size : null,
    releasePage: rel.html_url,
    prerelease: !!rel.prerelease,
  };
}

function fallbackEntry(tool) {
  const k = tool.latestKnown;
  return {
    tag: k.tag,
    version: k.version,
    publishedAt: k.publishedAt,
    notes: '',
    url: assetUrl(k.tag, tool.assetName),
    size: null,
    releasePage: `https://github.com/${REPO}/releases/tag/${k.tag}`,
    prerelease: false,
    fromFallback: true,
  };
}

export default function SoftwareDownloads() {
  const [releases, setReleases] = useState(null);   // null = loading
  const [fetchFailed, setFetchFailed] = useState(false);
  const [openTool, setOpenTool] = useState({});
  const [showOlder, setShowOlder] = useState({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setReleases(null);
    setFetchFailed(false);
    (async () => {
      try {
        const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
        if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
        const data = await res.json();
        if (!cancelled) setReleases(Array.isArray(data) ? data.filter(r => !r.draft) : []);
      } catch (e) {
        console.error('SoftwareDownloads: could not list releases:', e);
        if (!cancelled) { setReleases([]); setFetchFailed(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const loading = releases === null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Software downloads</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            Desktop tools that work alongside the portal. Newest version first; older versions are kept under each tool.
          </p>
        </div>
        <button
          onClick={() => setReloadKey(k => k + 1)}
          disabled={loading}
          className="flex items-center gap-1.5 border border-gray-300 text-gray-700 px-3 py-1.5 rounded text-sm hover:bg-gray-50 transition disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {fetchFailed && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            Could not reach GitHub to check for newer versions, so each tool shows the latest version known at the last portal deploy. The download links still work.
          </span>
        </div>
      )}

      {SOFTWARE_CATALOG.map(tool => {
        const own = (releases || [])
          .filter(r => typeof r.tag_name === 'string' && r.tag_name.startsWith(tool.tagPrefix))
          .map(r => toEntry(tool, r))
          .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
        const entries = own.length > 0 ? own : (loading ? [] : [fallbackEntry(tool)]);
        const latest = entries[0] || null;
        const older = entries.slice(1);
        const isOpen = !!openTool[tool.key];

        return (
          <div key={tool.key} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
            <div className="p-4 flex flex-col md:flex-row md:items-start gap-4">
              <div className="flex-shrink-0 w-11 h-11 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Monitor size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-base font-semibold text-gray-900">{tool.name}</h4>
                  {latest && (
                    <span className="text-xs font-medium bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">v{latest.version}</span>
                  )}
                  {latest?.prerelease && (
                    <span className="text-xs font-medium bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">Pre-release</span>
                  )}
                </div>
                <p className="text-sm text-gray-700 mt-0.5">{tool.tagline}</p>
                <p className="text-xs text-gray-500 mt-1">{tool.platform}{latest?.publishedAt ? ` · Released ${fmtDate(latest.publishedAt)}` : ''}{latest?.size ? ` · ${fmtSize(latest.size)}` : ''}</p>
                <button
                  onClick={() => setOpenTool(prev => ({ ...prev, [tool.key]: !isOpen }))}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline"
                >
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {isOpen ? 'Hide details' : 'What it does and how to install'}
                </button>
              </div>
              <div className="flex-shrink-0 flex flex-col items-stretch md:items-end gap-2">
                {loading ? (
                  <span className="text-xs text-gray-400">Checking for the latest version…</span>
                ) : latest ? (
                  <a
                    href={latest.url}
                    className="inline-flex items-center justify-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition"
                  >
                    <Download size={16} /> Download v{latest.version}
                  </a>
                ) : (
                  <span className="text-xs text-gray-500">No release published yet.</span>
                )}
                {latest?.releasePage && (
                  <a href={latest.releasePage} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 md:justify-end">
                    Release notes <ExternalLink size={11} />
                  </a>
                )}
              </div>
            </div>

            {isOpen && (
              <div className="border-t border-gray-100 bg-gray-50 p-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="md:col-span-2">
                  <p className="text-gray-700">{tool.description}</p>
                </div>
                <div>
                  <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">You will need</h5>
                  <ul className="list-disc pl-5 space-y-1 text-gray-700 text-sm">
                    {tool.requirements.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
                <div>
                  <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Install</h5>
                  <ol className="list-decimal pl-5 space-y-1 text-gray-700 text-sm">
                    {tool.steps.map((st, i) => <li key={i}>{st}</li>)}
                  </ol>
                </div>
                {latest?.notes && (
                  <div className="md:col-span-2">
                    <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">What's in v{latest.version}</h5>
                    <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700">{latest.notes}</pre>
                  </div>
                )}
              </div>
            )}

            {older.length > 0 && (
              <div className="border-t border-gray-100 px-4 py-2">
                <button
                  onClick={() => setShowOlder(prev => ({ ...prev, [tool.key]: !prev[tool.key] }))}
                  className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"
                >
                  {showOlder[tool.key] ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  {older.length} older version{older.length === 1 ? '' : 's'}
                </button>
                {showOlder[tool.key] && (
                  <ul className="mt-2 divide-y divide-gray-100">
                    {older.map(e => (
                      <li key={e.tag} className="py-1.5 flex items-center justify-between gap-3 text-xs">
                        <span className="text-gray-700">
                          v{e.version}{e.publishedAt ? <span className="text-gray-400"> · {fmtDate(e.publishedAt)}</span> : null}
                          {e.prerelease && <span className="ml-2 bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full">Pre-release</span>}
                        </span>
                        <a href={e.url} className="inline-flex items-center gap-1 text-indigo-700 hover:underline flex-shrink-0">
                          <Download size={12} /> Download{e.size ? ` (${fmtSize(e.size)})` : ''}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
