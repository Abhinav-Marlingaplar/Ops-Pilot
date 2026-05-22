/**
 * frontend/src/components/AuthGuard.jsx  (Phase 2 — fixed)
 *
 * Unauthenticated users → /#/login (LoginPage inside React app)
 * LoginPage then handles the GitHub OAuth flow.
 */

import { useEffect } from 'react';
import { useAuth }   from '../hooks/useAuth';

export default function AuthGuard({ children }) {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      // Go to login page inside the React app
      window.location.hash = '#/login';
    }
  }, [user, loading]);

  if (loading) {
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

  if (!user) return null;

  return children;
}