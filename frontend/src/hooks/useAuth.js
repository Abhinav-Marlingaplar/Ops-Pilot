/**
 * frontend/src/hooks/useAuth.js  (Phase 2 — fixed)
 *
 * logout() no longer redirects — the caller decides where to go.
 * This lets Dashboard send users to landing.html on logout.
 */

import { useState, useEffect, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000';

export function useAuth() {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  // Check session on mount
  useEffect(() => {
    let cancelled = false;
    async function checkSession() {
      try {
        const res = await fetch(`${API_BASE}/auth/me`, {
          credentials: 'include',
        });
        if (cancelled) return;
        if (res.ok) {
          const { user: me } = await res.json();
          setUser(me);
        } else {
          setUser(null);
        }
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    checkSession();
    return () => { cancelled = true; };
  }, []);

  // Login — redirect to GitHub OAuth
  const login = useCallback(() => {
    window.location.href = `${API_BASE}/auth/github`;
  }, []);

  // Logout — clears session, does NOT redirect (caller handles navigation)
  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method:      'POST',
        credentials: 'include',
      });
    } catch {
      // swallow — still clear local state
    }
    setUser(null);
    // No redirect here — App.jsx Dashboard.handleLogout sends to landing.html
  }, []);

  return { user, loading, login, logout };
}