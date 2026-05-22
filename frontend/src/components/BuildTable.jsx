/**
 * components/BuildTable.jsx
 *
 * Renders the build list as a styled table.
 * - New rows (in newBuildIds) get the slide-in-left animation
 * - Skeleton rows shown while loading
 * - Clicking a row calls onSelectBuild(build)
 */

import { StatusBadge } from './StatusBadge'

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function relativeTime(dateStr) {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60)   return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60)   return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)   return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function shortCommit(commit) {
  if (!commit || commit === 'HEAD') return 'HEAD'
  return commit.slice(0, 7)
}

function repoName(repository) {
  try {
    const parts = repository.replace(/\.git$/, '').split('/')
    return parts.slice(-2).join('/')
  } catch {
    return repository
  }
}

/* ── Skeleton ─────────────────────────────────────────────────────────────── */

function SkeletonRow({ delay }) {
  return (
    <tr style={{ animationDelay: `${delay}ms` }}>
      {[120, 80, 60, 80, 60].map((w, i) => (
        <td key={i} style={{ padding: '14px 16px' }}>
          <div className="skeleton" style={{ height: '14px', width: `${w}px` }} />
        </td>
      ))}
    </tr>
  )
}

/* ── Main component ───────────────────────────────────────────────────────── */

export function BuildTable({ builds, loading, newBuildIds, selectedBuildId, onSelectBuild }) {
  const thStyle = {
    padding:       '10px 16px',
    textAlign:     'left',
    fontSize:      '10px',
    fontWeight:    600,
    color:         'var(--text-tertiary)',
    letterSpacing: '0.07em',
    textTransform: 'uppercase',
    borderBottom:  '1px solid var(--border-subtle)',
    background:    'var(--bg-panel-alt)',
    whiteSpace:    'nowrap',
  }

  return (
    <div style={{
      background:   'var(--bg-panel)',
      border:       '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)',
      overflow:     'hidden',
      boxShadow:    'var(--shadow-sm)',
    }}>
      {/* Table header */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '16px 20px 14px',
        borderBottom:   '1px solid var(--border-subtle)',
      }}>
        <div>
          <h2 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Recent Builds
          </h2>
          <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
            {loading ? 'Loading…' : `${builds.length} build${builds.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Repository</th>
              <th style={thStyle}>Branch / Commit</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Worker</th>
              <th style={thStyle}>Triggered</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 5 }).map((_, i) => (
              <SkeletonRow key={i} delay={i * 60} />
            ))}

            {!loading && builds.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: '48px 20px', textAlign: 'center' }}>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>
                    No builds yet. Trigger one with a webhook POST.
                  </div>
                </td>
              </tr>
            )}

            {!loading && builds.map((build, idx) => {
              const isNew      = newBuildIds.has(build.id)
              const isSelected = selectedBuildId === build.id
              const isRunning  = build.status === 'running'

              return (
                <tr
                  key={build.id}
                  onClick={() => onSelectBuild(build)}
                  className={isNew ? 'animate-slide-left' : undefined}
                  style={{
                    animationDelay: isNew ? '0ms' : `${idx * 30}ms`,
                    cursor:         'pointer',
                    borderBottom:   '1px solid var(--border-subtle)',
                    background:     isSelected
                      ? 'var(--accent-light)'
                      : 'transparent',
                    transition:     'background var(--duration-fast) ease',
                    position:       'relative',
                  }}
                  onMouseEnter={e => {
                    if (!isSelected) e.currentTarget.style.background = 'var(--bg-panel-alt)'
                  }}
                  onMouseLeave={e => {
                    if (!isSelected) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  {/* Selected accent bar on left */}
                  {isSelected && (
                    <td style={{
                      position: 'absolute',
                      left: 0, top: 0, bottom: 0,
                      width: '3px',
                      background: 'var(--accent)',
                      borderRadius: '0 2px 2px 0',
                      padding: 0,
                      border: 'none',
                    }} />
                  )}

                  {/* Repository */}
                  <td style={{ padding: '13px 16px' }}>
                    <div style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize:   '12px',
                      fontWeight: 500,
                      color:      'var(--text-primary)',
                      maxWidth:   '200px',
                      overflow:   'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {repoName(build.repository)}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                      #{build.id}
                    </div>
                  </td>

                  {/* Branch / Commit */}
                  <td style={{ padding: '13px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{
                        display:      'inline-flex',
                        alignItems:   'center',
                        gap:          '4px',
                        fontSize:     '11px',
                        fontFamily:   'var(--font-mono)',
                        color:        'var(--accent)',
                        background:   'var(--accent-light)',
                        padding:      '2px 7px',
                        borderRadius: '4px',
                        fontWeight:   500,
                      }}>
                        ⎇ {build.branch}
                      </span>
                      <span style={{
                        fontSize:   '11px',
                        fontFamily: 'var(--font-mono)',
                        color:      'var(--text-tertiary)',
                      }}>
                        {shortCommit(build.commit)}
                      </span>
                    </div>
                  </td>

                  {/* Status */}
                  <td style={{ padding: '13px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <StatusBadge status={build.status} size="sm" />
                      {isRunning && (
                        <RunningDuration createdAt={build.created_at} />
                      )}
                    </div>
                  </td>

                  {/* Worker */}
                  <td style={{ padding: '13px 16px' }}>
                    <span style={{
                      fontSize:   '11px',
                      fontFamily: 'var(--font-mono)',
                      color:      'var(--text-tertiary)',
                    }}>
                      {build.worker_id ?? '—'}
                    </span>
                  </td>

                  {/* Triggered */}
                  <td style={{ padding: '13px 16px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {relativeTime(build.created_at)}
                    </span>
                  </td>

                  {/* Action */}
                  <td style={{ padding: '13px 16px', textAlign: 'right' }}>
                    <button
                      onClick={e => { e.stopPropagation(); onSelectBuild(build) }}
                      style={{
                        fontSize:     '11px',
                        fontFamily:   'var(--font-ui)',
                        fontWeight:   500,
                        color:        isSelected ? 'var(--accent)' : 'var(--text-secondary)',
                        background:   'transparent',
                        border:       '1px solid var(--border-medium)',
                        borderRadius: 'var(--radius-sm)',
                        padding:      '4px 10px',
                        cursor:       'pointer',
                        transition:   'all var(--duration-fast) ease',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = 'var(--accent)'
                        e.currentTarget.style.color = 'var(--accent)'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = 'var(--border-medium)'
                        e.currentTarget.style.color = isSelected ? 'var(--accent)' : 'var(--text-secondary)'
                      }}
                    >
                      Logs →
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── Running duration ticker ──────────────────────────────────────────────── */
function RunningDuration({ createdAt }) {
  const [secs, setSecs] = useState(() =>
    Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000)
  )

  useEffect(() => {
    const id = setInterval(() => {
      setSecs(Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [createdAt])

  const m = Math.floor(secs / 60)
  const s = secs % 60
  return (
    <span style={{
      fontSize:   '10px',
      fontFamily: 'var(--font-mono)',
      color:      'var(--status-running-fg)',
      background: 'var(--status-running-bg)',
      padding:    '1px 6px',
      borderRadius: '4px',
    }}>
      {m > 0 ? `${m}m ` : ''}{String(s).padStart(2,'0')}s
    </span>
  )
}

// Need useState import in this file too
import { useEffect, useState } from 'react'