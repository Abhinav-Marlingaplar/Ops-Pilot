/**
 * frontend/src/App.jsx
 *
 * Flow:
 *   /                → RootRedirect:
 *                        has session cookie → /#/dashboard  (instant)
 *                        no session cookie  → /#/landing    (instant, no API call)
 *   /#/landing       → LandingPage (public, fully React — no external HTML file)
 *   /#/login         → LoginPage (public)
 *   /#/dashboard     → AuthGuard → Dashboard (protected)
 *   Logout           → /#/landing
 *
 * ── Why LandingPage is now a React component ─────────────────────────────────
 * The previous approach served landing/index.html as a static file at
 * /landing.html. Vercel's SPA catch-all rewrite was intercepting the first
 * request and serving React's index.html instead — causing a redirect loop
 * where DOMContentLoaded fired on the wrong document, breaking all animations.
 *
 * Moving the landing page into React eliminates the routing conflict entirely.
 * Animations are driven by useEffect + IntersectionObserver, which are
 * guaranteed to run after React's first paint — no DOMContentLoaded needed.
 */

import { useState, useEffect } from 'react';
import { useAuth }      from './hooks/useAuth';
import { useBuilds }    from './hooks/useBuilds';
import { useSocket }    from './hooks/useSocket';
import AuthGuard        from './components/AuthGuard';
import LoginPage        from './components/LoginPage';
import LandingPage      from './components/LandingPage';
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
function RootRedirect() {
  useEffect(() => {
    const hasSession = document.cookie
      .split(';')
      .some(c => c.trim().startsWith('connect.sid=') || c.trim().startsWith('session='));

    if (hasSession) {
      window.location.hash = '#/dashboard';
    } else {
      // Go to React landing page — no external file, no redirect loop
      window.location.hash = '#/landing';
    }
  }, []);

  return <div style={{ minHeight: '100vh', background: '#080b0f' }} />;
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
    // Navigate to React landing page, not external file
    window.location.hash = '#/landing';
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
  if (route === '/landing')   return <LandingPage />;
  if (route === '/login')     return <LoginPage />;
  if (route === '/dashboard') return <AuthGuard><Dashboard /></AuthGuard>;
  return <RootRedirect />;
}