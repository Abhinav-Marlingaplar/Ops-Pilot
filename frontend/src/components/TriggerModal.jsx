import { useState, useCallback, useRef, useEffect } from 'react';

const RECENT_REPOS_KEY = 'opspilot_recent_repos';
const MAX_RECENT = 5;

function getRecentRepos() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_REPOS_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveRecentRepo(repo) {
  const existing = getRecentRepos().filter(r => r !== repo);
  const updated = [repo, ...existing].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(updated));
}

export default function TriggerModal({ onClose, onTriggered }) {
  const [form, setForm] = useState({ repository: '', branch: 'main', commit: 'HEAD' });
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState('idle'); // idle | loading | success | error
  const [errorMsg, setErrorMsg] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [recentRepos] = useState(getRecentRepos);
  const repoRef = useRef(null);
  const overlayRef = useRef(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Focus repo input on mount
  useEffect(() => {
    repoRef.current?.focus();
  }, []);

  const validate = () => {
    const errs = {};
    const repoPattern = /^https?:\/\/.+\/.+\/.+$/;
    if (!form.repository.trim()) {
      errs.repository = 'Repository URL is required';
    } else if (!repoPattern.test(form.repository.trim())) {
      errs.repository = 'Must be a valid https:// repository URL';
    }
    if (!form.branch.trim()) {
      errs.branch = 'Branch is required';
    }
    if (!form.commit.trim()) {
      errs.commit = 'Commit ref is required';
    }
    return errs;
  };

  const handleChange = (field) => (e) => {
    setForm(f => ({ ...f, [field]: e.target.value }));
    if (errors[field]) setErrors(err => ({ ...err, [field]: undefined }));
    if (field === 'repository') setShowSuggestions(true);
  };

  const handleSubmit = useCallback(async () => {
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setStatus('loading');
    setErrorMsg('');
    try {
      const token = import.meta.env.VITE_JWT_TOKEN;
      const res = await fetch('/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          repository: form.repository.trim(),
          branch: form.branch.trim(),
          commit: form.commit.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || body.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      saveRecentRepo(form.repository.trim());
      setStatus('success');
      setTimeout(() => {
        onTriggered?.(data);
        onClose();
      }, 900);
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.message || 'Failed to trigger build');
    }
  }, [form, onClose, onTriggered]);

  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) onClose();
  };

  const filteredRepos = recentRepos.filter(r =>
    r.toLowerCase().includes(form.repository.toLowerCase()) && r !== form.repository
  );

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'fadeIn 0.15s ease',
      }}
    >
      <div style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        width: '100%',
        maxWidth: '480px',
        padding: '32px',
        boxShadow: '0 24px 80px rgba(0,255,136,0.08), 0 8px 32px rgba(0,0,0,0.6)',
        animation: 'slideUp 0.2s cubic-bezier(0.34,1.56,0.64,1)',
        position: 'relative',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 20 }}>⚡</span>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                Trigger Build
              </h2>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-ui)' }}>
              Queue a new pipeline run
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', fontSize: 20, lineHeight: 1,
              padding: '2px 6px', borderRadius: 4,
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => e.target.style.color = 'var(--text-primary)'}
            onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}
          >
            ×
          </button>
        </div>

        {/* Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Repository */}
          <div style={{ position: 'relative' }}>
            <label style={labelStyle}>Repository URL</label>
            <input
              ref={repoRef}
              value={form.repository}
              onChange={handleChange('repository')}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              placeholder="https://github.com/owner/repo"
              style={{ ...inputStyle, borderColor: errors.repository ? '#ef4444' : undefined }}
              disabled={status === 'loading' || status === 'success'}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
            {errors.repository && <span style={errorStyle}>{errors.repository}</span>}
            {showSuggestions && filteredRepos.length > 0 && (
              <div style={suggestionsStyle}>
                {filteredRepos.map(repo => (
                  <button
                    key={repo}
                    onMouseDown={() => {
                      setForm(f => ({ ...f, repository: repo }));
                      setShowSuggestions(false);
                    }}
                    style={suggestionItemStyle}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.05))'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>↺</span>
                    {repo}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Branch + Commit row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={labelStyle}>Branch</label>
              <input
                value={form.branch}
                onChange={handleChange('branch')}
                placeholder="main"
                style={{ ...inputStyle, borderColor: errors.branch ? '#ef4444' : undefined }}
                disabled={status === 'loading' || status === 'success'}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
              {errors.branch && <span style={errorStyle}>{errors.branch}</span>}
            </div>
            <div>
              <label style={labelStyle}>Commit / Ref</label>
              <input
                value={form.commit}
                onChange={handleChange('commit')}
                placeholder="HEAD"
                style={{ ...inputStyle, borderColor: errors.commit ? '#ef4444' : undefined }}
                disabled={status === 'loading' || status === 'success'}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
              {errors.commit && <span style={errorStyle}>{errors.commit}</span>}
            </div>
          </div>

          {/* Error banner */}
          {status === 'error' && (
            <div style={{
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 8, padding: '10px 14px',
              color: '#f87171', fontSize: 13,
              fontFamily: 'var(--font-mono)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span>⚠</span> {errorMsg}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
            <button
              onClick={onClose}
              style={cancelBtnStyle}
              disabled={status === 'loading'}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={status === 'loading' || status === 'success'}
              style={{
                ...triggerBtnStyle,
                opacity: status === 'loading' || status === 'success' ? 0.85 : 1,
              }}
            >
              {status === 'loading' && <Spinner />}
              {status === 'success' && <span>✓</span>}
              {status === 'idle' || status === 'error' ? '⚡ Run Pipeline' : ''}
              {status === 'loading' ? 'Queuing…' : ''}
              {status === 'success' ? 'Queued!' : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span style={{
      display: 'inline-block', width: 14, height: 14,
      border: '2px solid rgba(0,0,0,0.3)',
      borderTopColor: '#000',
      borderRadius: '50%',
      animation: 'spin 0.6s linear infinite',
      flexShrink: 0,
    }} />
  );
}

// Styles
const labelStyle = {
  display: 'block',
  marginBottom: 6,
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-ui)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '10px 14px',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  outline: 'none',
  transition: 'border-color 0.15s, box-shadow 0.15s',
  caretColor: 'var(--accent)',
};

const errorStyle = {
  display: 'block',
  marginTop: 5,
  fontSize: 12,
  color: '#f87171',
  fontFamily: 'var(--font-ui)',
};

const suggestionsStyle = {
  position: 'absolute',
  top: '100%',
  left: 0, right: 0,
  zIndex: 10,
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  marginTop: 4,
  overflow: 'hidden',
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
};

const suggestionItemStyle = {
  display: 'flex', alignItems: 'center', gap: 8,
  width: '100%', textAlign: 'left',
  padding: '10px 14px',
  background: 'transparent', border: 'none',
  cursor: 'pointer',
  color: 'var(--text-secondary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  transition: 'background 0.1s',
};

const cancelBtnStyle = {
  flex: 1,
  padding: '11px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-ui)',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'border-color 0.15s, color 0.15s',
};

const triggerBtnStyle = {
  flex: 2,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  padding: '11px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--accent)',
  color: '#000',
  fontFamily: 'var(--font-ui)',
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
  transition: 'opacity 0.15s, transform 0.1s',
  letterSpacing: '0.02em',
};