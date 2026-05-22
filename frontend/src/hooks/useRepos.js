/**
 * frontend/src/hooks/useRepos.js  (Phase 2)
 *
 * Manages repository state:
 *   - githubRepos  : repos fetched from GitHub API (user's full list)
 *   - connectedRepos: repos connected in our DB
 *   - connect(repo)    : POST /repos to connect + register webhook
 *   - disconnect(id)   : DELETE /repos/:id to disconnect + delete webhook
 */

import { useState, useEffect, useCallback } from 'react';

const API = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000';

export function useRepos() {
  const [githubRepos,    setGithubRepos]    = useState([]);
  const [loadingGithub,  setLoadingGithub]  = useState(true);
  const [loadingAction,  setLoadingAction]  = useState(null); // repo id being actioned
  const [error,          setError]          = useState(null);
  const [page,           setPage]           = useState(1);
  const [hasMore,        setHasMore]        = useState(true);
  const [search,         setSearch]         = useState('');

  // ── Fetch GitHub repos ─────────────────────────────────────────────────────
  const fetchGithubRepos = useCallback(async (pageNum = 1, replace = false) => {
    try {
      setLoadingGithub(true);
      setError(null);

      const res = await fetch(
        `${API}/repos/github?page=${pageNum}&per_page=30`,
        { credentials: 'include' },
      );

      if (!res.ok) {
        const { error: msg } = await res.json();
        throw new Error(msg ?? `HTTP ${res.status}`);
      }

      const { repos } = await res.json();

      setGithubRepos(prev => replace ? repos : [...prev, ...repos]);
      setHasMore(repos.length === 30);
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
        const { error: msg } = await res.json();
        throw new Error(msg ?? `HTTP ${res.status}`);
      }

      // Mark as connected in local state immediately
      setGithubRepos(prev =>
        prev.map(r =>
          r.github_repo_id === repo.github_repo_id
            ? { ...r, connected: true }
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
        const { error: msg } = await res.json();
        throw new Error(msg ?? `HTTP ${res.status}`);
      }

      setGithubRepos(prev =>
        prev.map(r =>
          r.github_repo_id === githubRepoId
            ? { ...r, connected: false }
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
    if (!loadingGithub && hasMore) {
      fetchGithubRepos(page + 1, false);
    }
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