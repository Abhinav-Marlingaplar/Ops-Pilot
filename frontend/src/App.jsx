/**
 * frontend/src/App.jsx
 *
 * Flow:
 *   /                → RootRedirect:
 *                        has session cookie → /#/dashboard  (instant)
 *                        no session cookie  → /landing.html (instant, no API call)
 *   /landing.html "Get Started" → /#/login → LoginPage → OAuth → /#/dashboard
 *   /#/login         → LoginPage (public)
 *   /#/dashboard     → AuthGuard → Dashboard (protected)
 *   Logout           → /landing.html
 *
 * ── Why the old RootRedirect was slow ────────────────────────────────────────
 * The previous implementation called useAuth() which hits GET /auth/me on the
 * Render backend. On a cold start that takes 20-30s. The user saw a spinner
 * for 30 seconds before the landing page even appeared.
 *
 * Fix: check for the session cookie CLIENT-SIDE before making any API call.
 * If the cookie isn't present, redirect to landing.html immediately — no
 * network request needed. If it is present, go to dashboard (AuthGuard there
 * will handle the actual token validation).
 */

import { useState, useEffect } from 'react';
import { useAuth }      from './hooks/useAuth';
import { useBuilds }    from './hooks/useBuilds';
import { useSocket }    from './hooks/useSocket';
import AuthGuard        from './components/AuthGuard';
import LoginPage        from './components/LoginPage';
import { BuildDetail }  from './components/BuildDetail';
import { ReposPage }    from './components/ReposPage';
import { Sidebar }      from './components/Sidebar';
import { TopBar }       from './components/TopBar';
import { StatsRow }     from './components/StatsRow';
import { BuildTable }   from './components/BuildTable';

// ─── Hash router ──────────────────────────────────────────────────────────────
function useHashRoute() {
  const [route, setRoute] = useState(() =>
    window.location.hash.replace('#', '') || '/',
  );
  useEffect(() => {
    function onHashChange() {
      setRoute(window.location.hash.replace('#', '') || '/');
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return route;
}

// ─── Root redirect ────────────────────────────────────────────────────────────
// Decides instantly whether to show landing page or dashboard.
// Does NOT call the backend — checks cookie presence client-side only.
// AuthGuard on the dashboard route handles actual session validation.
function RootRedirect() {
  useEffect(() => {
    // Check if a session cookie exists without hitting the API.
    // The cookie name must match what your backend sets (adjust if different).
    const hasSession = document.cookie
      .split(';')
      .some(c => c.trim().startsWith('connect.sid=') || c.trim().startsWith('session='))

    if (hasSession) {
      // Likely logged in — go to dashboard. AuthGuard will validate properly.
      window.location.hash = '#/dashboard'
    } else {
      // Definitely not logged in — go straight to landing page, no spinner.
      window.location.href = '/landing.html'
    }
  }, [])

  // Minimal spinner shown for ~1 frame before the redirect fires
  return (
    <div style={{
      minHeight: '100vh',
      background: '#080b0f',
    }} />
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard() {
  const { user, logout }             = useAuth();
  const { socket, connected }        = useSocket();
  const { builds, newBuildIds }      = useBuilds(socket);
  const [selectedBuild, setSelected] = useState(null);
  const [activePage, setActivePage]  = useState('dashboard');

  async function handleLogout() {
    await logout();
    window.location.href = '/landing.html';
  }

  function handleNavigate(page) {
    setActivePage(page);
    if (page !== 'dashboard') setSelected(null);
  }

  return (
    <div className="app-shell">
      <Sidebar
        user={user}
        onLogout={handleLogout}
        activePage={activePage}
        onNavigate={handleNavigate}
      />
      <div className="main-content">
        <TopBar connected={connected} builds={builds} user={user} onLogout={handleLogout} />
        <div className="page-body">

          {(activePage === 'dashboard' || activePage === 'builds') && (
            <>
              <StatsRow builds={builds} />
              <div className={`content-grid${selectedBuild ? ' content-grid--split' : ''}`}>
                <BuildTable
                  builds={builds}
                  newBuildIds={newBuildIds}
                  onSelectBuild={setSelected}
                  selectedId={selectedBuild?.id}
                  onSelect={setSelected}
                />
                {selectedBuild && (
                  <BuildDetail
                    buildId={selectedBuild.id}
                    onClose={() => setSelected(null)}
                  />
                )}
              </div>
            </>
          )}

          {activePage === 'repos' && <ReposPage />}

          {activePage === 'settings' && (
            <div style={{
              padding: '48px 24px', textAlign: 'center',
              background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
            }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>⚙</div>
              <p style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                Settings — coming in Phase 3
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const route = useHashRoute();

  if (route === '/login')     return <LoginPage />;
  if (route === '/dashboard') return <AuthGuard><Dashboard /></AuthGuard>;
  return <RootRedirect />;
}