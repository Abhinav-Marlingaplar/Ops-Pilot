/**
 * frontend/src/App.jsx  (Phase 2 — routing fixed final)
 *
 * Flow:
 *   landing.html "Get Started" → /#/login → LoginPage → OAuth → /#/dashboard
 *   Direct visit to /          → RootRedirect:
 *                                  logged in  → /#/dashboard
 *                                  logged out → /landing.html
 *   Logout → /landing.html
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
// Only reached when user navigates directly to localhost:5173 (no hash).
// If logged in → dashboard. If not → landing page.
// This is NOT triggered by landing.html buttons (they use /#/login directly).
function RootRedirect() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (user) {
      window.location.hash = '#/dashboard';
    } else {
      window.location.href = '/landing.html';
    }
  }, [user, loading]);

  // Spinner while session check is in flight
  return (
    <div style={{
      minHeight: '100vh', background: '#080b0f',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: '32px', height: '32px',
        border: '2px solid rgba(0,255,136,0.15)',
        borderTopColor: '#00ff88', borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />
    </div>
  );
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

  // /#/login  — public login page
  if (route === '/login')     return <LoginPage />;

  // /#/dashboard — protected dashboard
  if (route === '/dashboard') return <AuthGuard><Dashboard /></AuthGuard>;

  // / (no hash) — smart redirect based on auth state
  // NOTE: landing.html buttons use /#/login directly and never hit this
  return <RootRedirect />;
}