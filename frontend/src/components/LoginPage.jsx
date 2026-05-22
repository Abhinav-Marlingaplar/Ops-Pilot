/**
 * frontend/src/components/LoginPage.jsx  (Phase 2 — fixed)
 *
 * login() now uses a relative URL (/auth/github) so it goes through
 * Vite's proxy in dev and the same domain in production.
 * This ensures the OAuth callback returns to the correct origin.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';

const ERROR_MESSAGES = {
  oauth_denied:   'GitHub authorisation was cancelled.',
  state_mismatch: 'Security check failed. Please try again.',
  server_error:   'Something went wrong on our end. Please try again.',
  no_code:        'No authorisation code received from GitHub.',
};

export default function LoginPage() {
  const { user, loading } = useAuth();
  const [errorMsg, setErrorMsg]   = useState('');
  const [signingIn, setSigningIn] = useState(false);

  // Read error param from OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err    = params.get('error');
    if (err) setErrorMsg(ERROR_MESSAGES[err] ?? 'An unknown error occurred.');
  }, []);

  // Already logged in — go to dashboard
  useEffect(() => {
    if (!loading && user) {
      window.location.hash = '#/dashboard';
    }
  }, [user, loading]);

  function handleLogin() {
    setSigningIn(true);
    // Use relative URL so it goes through Vite proxy in dev
    // and same-origin in production
    window.location.href = '/auth/github';
  }

  if (loading) {
    return (
      <div className="login-page">
        <div className="login-spinner" />
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Logo */}
        <div className="login-logo">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <rect width="40" height="40" rx="10" fill="#00ff88" fillOpacity="0.1"
                  stroke="#00ff88" strokeWidth="1.5"/>
            <polyline points="8,28 16,12 24,22 32,10"
                      stroke="#00ff88" strokeWidth="2.5"
                      strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            <circle cx="32" cy="10" r="3" fill="#00ff88"/>
          </svg>
        </div>

        <h1 className="login-title">OpsPilot</h1>
        <p className="login-subtitle">
          Cloud-native CI/CD. Connect your GitHub repo and ship.
        </p>

        {errorMsg && (
          <div className="login-error" role="alert">
            <span className="login-error-icon">⚠</span>
            {errorMsg}
          </div>
        )}

        <button
          className={`login-btn${signingIn ? ' login-btn--loading' : ''}`}
          onClick={handleLogin}
          disabled={signingIn}
          type="button"
        >
          {signingIn ? (
            <>
              <span className="login-btn-spinner" />
              Redirecting to GitHub…
            </>
          ) : (
            <>
              <GitHubIcon />
              Continue with GitHub
            </>
          )}
        </button>

        <p className="login-fine-print">
          We request <code>read:user</code> and <code>repo</code> scopes to
          read your profile and register webhooks on connected repositories.
        </p>
      </div>

      <style>{`
        .login-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-base, #080b0f);
          padding: 1.5rem;
        }
        .login-spinner {
          width: 32px; height: 32px;
          border: 2px solid rgba(0,255,136,0.2);
          border-top-color: #00ff88;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .login-card {
          width: 100%; max-width: 400px;
          background: var(--bg-panel, #0d1117);
          border: 1px solid rgba(0,255,136,0.15);
          border-radius: 16px;
          padding: 2.5rem 2rem;
          display: flex; flex-direction: column;
          align-items: center; gap: 1rem;
          box-shadow: 0 0 60px rgba(0,255,136,0.05);
        }
        .login-logo { margin-bottom: 0.25rem; }
        .login-title {
          font-family: 'JetBrains Mono', monospace;
          font-size: 1.6rem; font-weight: 700;
          color: var(--text-primary, #e6edf3);
          letter-spacing: -0.02em; margin: 0;
        }
        .login-subtitle {
          font-family: 'Inter', sans-serif;
          font-size: 0.875rem;
          color: var(--text-muted, #7d8590);
          text-align: center; margin: 0; line-height: 1.5;
        }
        .login-error {
          width: 100%;
          background: rgba(248,81,73,0.1);
          border: 1px solid rgba(248,81,73,0.3);
          border-radius: 8px; padding: 0.75rem 1rem;
          font-family: 'Inter', sans-serif; font-size: 0.8125rem;
          color: #f85149;
          display: flex; align-items: flex-start; gap: 0.5rem;
        }
        .login-error-icon { flex-shrink: 0; margin-top: 1px; }
        .login-btn {
          width: 100%; margin-top: 0.5rem;
          padding: 0.8125rem 1.25rem;
          background: #00ff88; color: #080b0f;
          border: none; border-radius: 10px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.9375rem; font-weight: 700;
          cursor: pointer;
          display: flex; align-items: center;
          justify-content: center; gap: 0.625rem;
          transition: opacity 0.15s, transform 0.1s;
          letter-spacing: -0.01em;
        }
        .login-btn:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
        .login-btn:active:not(:disabled) { transform: translateY(0); }
        .login-btn--loading, .login-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .login-btn-spinner {
          width: 16px; height: 16px;
          border: 2px solid rgba(8,11,15,0.3);
          border-top-color: #080b0f; border-radius: 50%;
          animation: spin 0.8s linear infinite; flex-shrink: 0;
        }
        .login-fine-print {
          font-family: 'Inter', sans-serif; font-size: 0.75rem;
          color: var(--text-muted, #7d8590);
          text-align: center; line-height: 1.6; margin: 0;
        }
        .login-fine-print code {
          font-family: 'JetBrains Mono', monospace;
          background: rgba(0,255,136,0.08); color: #00ff88;
          padding: 0.1em 0.35em; border-radius: 4px; font-size: 0.7rem;
        }
        .auth-guard-loader {
          min-height: 100vh; display: flex;
          align-items: center; justify-content: center;
          background: var(--bg-base, #080b0f);
        }
        .auth-guard-spinner {
          width: 36px; height: 36px;
          border: 2px solid rgba(0,255,136,0.15);
          border-top-color: #00ff88; border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
      `}</style>
    </div>
  );
}

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
    </svg>
  );
}