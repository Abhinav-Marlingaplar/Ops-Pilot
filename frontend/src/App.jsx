/**
 * frontend/src/App.jsx
 */

import { useState, useEffect } from 'react';
import { useAuth } from './hooks/useAuth';
import { useBuilds } from './hooks/useBuilds';
import { useSocket } from './hooks/useSocket';
import AuthGuard from './components/AuthGuard';
import LoginPage from './components/LoginPage';
import LandingPage from './components/LandingPage';
import { BuildDetail } from './components/BuildDetail';
import { ReposPage } from './components/ReposPage';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { StatsRow } from './components/StatsRow';
import { BuildTable } from './components/BuildTable';
import TriggerModal from './components/TriggerModal';

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
  const hasSession = document.cookie
    .split(';')
    .some(c => c.trim().startsWith('connect.sid=') || c.trim().startsWith('session='));

  useEffect(() => {
    if (hasSession) window.location.hash = '#/dashboard';
  }, [hasSession]);

  // If logged in, show blank while redirecting to dashboard.
  // If not logged in, render LandingPage directly — no hash change,
  // no second mount, animations work on first load.
  if (hasSession) return <div style={{ minHeight: '100vh', background: '#080b0f' }} />;
  return <LandingPage />;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard() {
  const { user, logout } = useAuth();
  const { socket, connected } = useSocket();
  const { builds, newBuildIds } = useBuilds(socket);
  const [selectedBuild, setSelected] = useState(null);
  const [activePage, setActivePage] = useState('dashboard');
  const [triggerOpen, setTriggerOpen] = useState(false);

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
        <TopBar
          connected={connected}
          builds={builds}
          user={user}
          onLogout={handleLogout}
          onTrigger={() => setTriggerOpen(true)}
        />
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
      {triggerOpen && (
        <TriggerModal
          onClose={() => setTriggerOpen(false)}
          onTriggered={(data) => console.log('Build queued:', data.job)}
        />
      )}
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const route = useHashRoute();
  if (route === '/landing') return <LandingPage />;
  if (route === '/login') return <LoginPage />;
  if (route === '/dashboard') return <AuthGuard><Dashboard /></AuthGuard>;
  return <RootRedirect />;
}