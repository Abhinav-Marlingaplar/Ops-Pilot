/**
 * frontend/src/components/ReposPage.jsx  (Phase 2)
 *
 * Full-page repository management view.
 * Lists the user's GitHub repos with connect / disconnect actions.
 * Matches the Terminal Noir design system.
 */

import { useRepos } from '../hooks/useRepos';

// ─── Language colour dots (subset of common languages) ───────────────────────
const LANG_COLORS = {
  JavaScript: '#f7df1e', TypeScript: '#3178c6', Python: '#3776ab',
  Go:         '#00add8', Rust:       '#dea584', Java: '#b07219',
  'C++':      '#f34b7d', C:          '#555555', Ruby: '#701516',
  Shell:      '#89e051', HTML:       '#e34c26', CSS:  '#563d7c',
  Dockerfile: '#384d54', default:    '#8b949e',
};

function LangDot({ language }) {
  if (!language) return null;
  const color = LANG_COLORS[language] ?? LANG_COLORS.default;
  return (
    <span style={{
      display: 'inline-block', width: '10px', height: '10px',
      borderRadius: '50%', background: color, flexShrink: 0,
    }} title={language} />
  );
}

function RepoCard({ repo, onConnect, onDisconnect, loading }) {
  const isLoading = loading === repo.github_repo_id;

  return (
    <div style={{
      background: 'var(--bg-panel)',
      border: `1px solid ${repo.connected ? 'rgba(0,255,136,0.2)' : 'var(--border-subtle)'}`,
      borderRadius: 'var(--radius-lg)',
      padding: '20px 24px',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '16px',
      transition: 'border-color 0.2s, box-shadow 0.2s',
      boxShadow: repo.connected ? '0 0 0 1px rgba(0,255,136,0.05)' : 'none',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Connected indicator stripe */}
      {repo.connected && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          height: '2px',
          background: 'linear-gradient(90deg, transparent, rgba(0,255,136,0.5), transparent)',
        }} />
      )}

      {/* Repo icon */}
      <div style={{
        width: '40px', height: '40px', borderRadius: '10px', flexShrink: 0,
        background: repo.connected ? 'rgba(0,255,136,0.08)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${repo.connected ? 'rgba(0,255,136,0.2)' : 'var(--border-subtle)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {repo.private ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="3" y="7" width="10" height="8" rx="2"
                  stroke={repo.connected ? '#00ff88' : '#4d5966'} strokeWidth="1.5"/>
            <path d="M5 7V5a3 3 0 0 1 6 0v2"
                  stroke={repo.connected ? '#00ff88' : '#4d5966'} strokeWidth="1.5"
                  strokeLinecap="round"/>
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 2h5l1 1h6v10H2V2z"
                  stroke={repo.connected ? '#00ff88' : '#4d5966'} strokeWidth="1.5"
                  strokeLinejoin="round"/>
          </svg>
        )}
      </div>

      {/* Repo info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
          <a
            href={repo.html_url} target="_blank" rel="noreferrer"
            style={{
              fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 600,
              color: repo.connected ? 'var(--accent)' : 'var(--text-primary)',
              textDecoration: 'none',
            }}
            onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
            onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
          >
            {repo.full_name}
          </a>
          {repo.private && (
            <span style={{
              fontSize: '10px', fontFamily: 'var(--font-mono)', fontWeight: 600,
              color: 'var(--text-tertiary)', background: 'rgba(255,255,255,0.06)',
              border: '1px solid var(--border-subtle)',
              padding: '1px 6px', borderRadius: '4px',
            }}>
              Private
            </span>
          )}
          {repo.connected && (
            <span style={{
              fontSize: '10px', fontFamily: 'var(--font-mono)', fontWeight: 600,
              color: 'var(--accent)', background: 'rgba(0,255,136,0.08)',
              border: '1px solid rgba(0,255,136,0.2)',
              padding: '1px 6px', borderRadius: '4px',
              display: 'flex', alignItems: 'center', gap: '4px',
            }}>
              <span style={{
                width: '5px', height: '5px', borderRadius: '50%',
                background: 'var(--accent)', animation: 'breathe 2s ease-in-out infinite',
              }} />
              Connected
            </span>
          )}
        </div>

        {repo.description && (
          <p style={{
            fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5,
            marginBottom: '10px', overflow: 'hidden', textOverflow: 'ellipsis',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>
            {repo.description}
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          {repo.language && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              <LangDot language={repo.language} />
              {repo.language}
            </span>
          )}
          <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            ⎇ {repo.default_branch}
          </span>
          {repo.stargazers > 0 && (
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              ★ {repo.stargazers}
            </span>
          )}
          {repo.pushed_at && (
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              Updated {timeAgo(repo.pushed_at)}
            </span>
          )}
        </div>
      </div>

      {/* Action button */}
      <div style={{ flexShrink: 0 }}>
        {repo.connected ? (
          <button
            onClick={() => onDisconnect(repo)}
            disabled={isLoading}
            style={{
              padding: '7px 14px', borderRadius: 'var(--radius-md)',
              border: '1px solid rgba(255,95,95,0.3)',
              background: 'rgba(255,95,95,0.06)',
              color: isLoading ? 'var(--text-tertiary)' : '#ff5f5f',
              fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 600,
              cursor: isLoading ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '6px',
            }}
            onMouseEnter={e => { if (!isLoading) e.currentTarget.style.background = 'rgba(255,95,95,0.12)' }}
            onMouseLeave={e => { if (!isLoading) e.currentTarget.style.background = 'rgba(255,95,95,0.06)' }}
          >
            {isLoading ? <Spinner /> : '✕'}
            {isLoading ? 'Disconnecting…' : 'Disconnect'}
          </button>
        ) : (
          <button
            onClick={() => onConnect(repo)}
            disabled={isLoading}
            style={{
              padding: '7px 14px', borderRadius: 'var(--radius-md)',
              border: '1px solid rgba(0,255,136,0.3)',
              background: 'rgba(0,255,136,0.07)',
              color: isLoading ? 'var(--text-tertiary)' : 'var(--accent)',
              fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 600,
              cursor: isLoading ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '6px',
            }}
            onMouseEnter={e => { if (!isLoading) e.currentTarget.style.background = 'rgba(0,255,136,0.14)' }}
            onMouseLeave={e => { if (!isLoading) e.currentTarget.style.background = 'rgba(0,255,136,0.07)' }}
          >
            {isLoading ? <Spinner /> : '+'}
            {isLoading ? 'Connecting…' : 'Connect'}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function ReposPage() {
  const {
    repos, loadingGithub, loadingAction, error,
    hasMore, search, setSearch,
    connect, disconnect, loadMore, refresh,
  } = useRepos();

  const connectedCount = repos.filter(r => r.connected).length;

  async function handleDisconnect(repo) {
    // We need the internal DB id to DELETE /repos/:id
    // Fetch connected repos to get the DB id
    try {
      const res = await fetch(
        `${import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000'}/repos`,
        { credentials: 'include' },
      );
      const { repos: connected } = await res.json();
      const found = connected.find(r => r.github_repo_id === repo.github_repo_id);
      if (found) {
        await disconnect(found.id, repo.github_repo_id);
      }
    } catch {
      await disconnect(null, repo.github_repo_id);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em', marginBottom: '4px' }}>
            Repositories
          </h2>
          <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            {loadingGithub ? 'Loading…' : `${repos.length} repos · ${connectedCount} connected`}
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loadingGithub}
          style={{
            padding: '7px 14px', borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-medium)',
            background: 'var(--bg-panel-alt)',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)', fontSize: '12px',
            cursor: loadingGithub ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: '6px',
          }}
        >
          ↺ Refresh
        </button>
      </div>

      {/* Info banner */}
      <div style={{
        padding: '12px 16px', borderRadius: 'var(--radius-md)',
        background: 'rgba(79,158,255,0.06)', border: '1px solid rgba(79,158,255,0.2)',
        fontSize: '12px', color: '#4f9eff', fontFamily: 'var(--font-mono)',
        display: 'flex', alignItems: 'flex-start', gap: '10px', lineHeight: 1.6,
      }}>
        <span style={{ flexShrink: 0 }}>ℹ</span>
        <span>
          Connecting a repo registers a GitHub webhook on your behalf.
          Every push to the default branch will automatically trigger a build.
          {!import.meta.env.VITE_BACKEND_URL?.includes('localhost') ? '' :
            ' Local dev: webhooks require a public URL (ngrok). Builds can still be triggered manually from the dashboard.'}
        </span>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          padding: '12px 16px', borderRadius: 'var(--radius-md)',
          background: 'rgba(255,95,95,0.08)', border: '1px solid rgba(255,95,95,0.25)',
          fontSize: '12px', color: '#ff5f5f', fontFamily: 'var(--font-mono)',
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <span>⚠</span> {error}
        </div>
      )}

      {/* Search */}
      <div style={{ position: 'relative' }}>
        <span style={{
          position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
          fontSize: '13px', color: 'var(--text-tertiary)', pointerEvents: 'none',
        }}>⌕</span>
        <input
          type="text"
          placeholder="Search repositories…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%', padding: '10px 12px 10px 34px',
            background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)', fontSize: '13px', outline: 'none',
            transition: 'border-color 0.15s',
          }}
          onFocus={e => e.target.style.borderColor = 'rgba(0,255,136,0.3)'}
          onBlur={e => e.target.style.borderColor = 'var(--border-subtle)'}
        />
        {search && (
          <button onClick={() => setSearch('')} style={{
            position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', color: 'var(--text-tertiary)',
            cursor: 'pointer', fontSize: '14px', padding: '0 4px',
          }}>✕</button>
        )}
      </div>

      {/* Repo list */}
      {loadingGithub && repos.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: '90px', borderRadius: 'var(--radius-lg)' }} />
          ))}
        </div>
      ) : repos.length === 0 ? (
        <div style={{
          padding: '48px 24px', textAlign: 'center',
          background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
        }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⎋</div>
          <p style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', fontSize: '13px' }}>
            {search ? `No repositories matching "${search}"` : 'No repositories found'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {repos.map(repo => (
            <RepoCard
              key={repo.github_repo_id}
              repo={repo}
              onConnect={connect}
              onDisconnect={handleDisconnect}
              loading={loadingAction}
            />
          ))}

          {/* Load more */}
          {hasMore && !search && (
            <button
              onClick={loadMore}
              disabled={loadingGithub}
              style={{
                padding: '12px', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-panel)',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)', fontSize: '12px',
                cursor: loadingGithub ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-panel-alt)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-panel)'}
            >
              {loadingGithub ? 'Loading…' : 'Load more repositories'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <span style={{
      width: '11px', height: '11px',
      border: '1.5px solid currentColor', borderTopColor: 'transparent',
      borderRadius: '50%', display: 'inline-block',
      animation: 'spin 0.6s linear infinite', flexShrink: 0,
    }} />
  );
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30)  return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}