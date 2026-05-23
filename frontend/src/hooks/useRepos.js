/**
 * frontend/src/hooks/useRepos.js  (Phase 2)
 *
 * Manages repository state:
 *   - githubRepos     : repos fetched from GitHub API (merged with DB state)
 *   - connect(repo)   : POST /repos to connect + register webhook
 *   - disconnect(id)  : DELETE /repos/:id to disconnect + delete webhook
 */

import { useState, useEffect, useCallback } from 'react';

const API = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000';

export function useRepos() {
  const [githubRepos,   setGithubRepos]   = useState([]);
  const [loadingGithub, setLoadingGithub] = useState(true);
  const [loadingAction, setLoadingAction] = useState(null); // github_repo_id being actioned
  const [error,         setError]         = useState(null);
  const [page,          setPage]          = useState(1);
  const [hasMore,       setHasMore]       = useState(true);
  const [search,        setSearch]        = useState('');

  // ── Fetch GitHub repos + merge DB state ────────────────────────────────────
  const fetchGithubRepos = useCallback(async (pageNum = 1, replace = false) => {
    try {
      setLoadingGithub(true);
      setError(null);

      // Fire both requests in parallel
      const [ghRes, dbRes] = await Promise.all([
        fetch(`${API}/repos/github?page=${pageNum}&per_page=30`, { credentials: 'include' }),
        fetch(`${API}/repos`, { credentials: 'include' }),
      ]);

      if (!ghRes.ok) {
        const body = await ghRes.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${ghRes.status}`);
      }

      const { repos: ghRepos } = await ghRes.json();
      const { repos: dbRepos } = dbRes.ok
        ? await dbRes.json()
        : { repos: [] };

      // Postgres bigint comes back as string from the `pg` driver.
      // Coerce both sides to Number so the Map lookup always hits.
      const dbMap = new Map(dbRepos.map(r => [Number(r.github_repo_id), r]));

      const merged = ghRepos.map(r => {
        const dbRow = dbMap.get(Number(r.github_repo_id)) ?? null;
        return {
          ...r,
          connected: dbRow !== null,
          db_id:     dbRow?.id ?? null,   // DB primary key — needed for DELETE /repos/:id
        };
      });

      setGithubRepos(prev => replace ? merged : [...prev, ...merged]);
      setHasMore(ghRepos.length === 30);
      setPage(pageNum);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingGithub(false);
    }
  }, []);

  // Initial load
  useEffect(() => { fetchGithubRepos(1, true); }, [fetchGithubRepos]);

  // ── Connect a repo ─────────────────────────────────────────────────────────
  const connect = useCallback(async (repo) => {
    setLoadingAction(repo.github_repo_id);
    setError(null);
    try {
      const res = await fetch(`${API}/repos`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          github_repo_id: repo.github_repo_id,
          full_name:      repo.full_name,
          clone_url:      repo.clone_url,
          default_branch: repo.default_branch,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      const { repo: savedRepo } = await res.json();

      // Update local state immediately with the real DB id from the response —
      // this ensures Disconnect works without needing a page refresh.
      setGithubRepos(prev =>
        prev.map(r =>
          Number(r.github_repo_id) === Number(repo.github_repo_id)
            ? { ...r, connected: true, db_id: savedRepo.id }
            : r,
        ),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingAction(null);
    }
  }, []);

  // ── Disconnect a repo ──────────────────────────────────────────────────────
  const disconnect = useCallback(async (repoId, githubRepoId) => {
    setLoadingAction(githubRepoId);
    setError(null);
    try {
      const res = await fetch(`${API}/repos/${repoId}`, {
        method:      'DELETE',
        credentials: 'include',
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      // Mark as disconnected and clear db_id in local state
      setGithubRepos(prev =>
        prev.map(r =>
          Number(r.github_repo_id) === Number(githubRepoId)
            ? { ...r, connected: false, db_id: null }
            : r,
        ),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingAction(null);
    }
  }, []);

  // ── Load more ──────────────────────────────────────────────────────────────
  const loadMore = useCallback(() => {
    if (!loadingGithub && hasMore) fetchGithubRepos(page + 1, false);
  }, [loadingGithub, hasMore, page, fetchGithubRepos]);

  // ── Filtered repos ─────────────────────────────────────────────────────────
  const filteredRepos = search.trim()
    ? githubRepos.filter(r =>
        r.full_name.toLowerCase().includes(search.toLowerCase()) ||
        (r.description ?? '').toLowerCase().includes(search.toLowerCase()),
      )
    : githubRepos;

  return {
    repos: filteredRepos,
    loadingGithub,
    loadingAction,
    error,
    hasMore,
    search,
    setSearch,
    connect,
    disconnect,
    loadMore,
    refresh: () => fetchGithubRepos(1, true),
  };
}