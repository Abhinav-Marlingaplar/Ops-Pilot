/**
 * components/PipelineStages.jsx
 *
 * GitHub Actions–style horizontal pipeline stage tracker.
 * Each stage node animates through: waiting → running → success / failed
 *
 * Visual design:
 *  - Waiting:  dim grey circle, dashed connector line
 *  - Running:  blue pulsing ring, solid connector, animated fill
 *  - Success:  solid green circle with checkmark, solid green connector
 *  - Failed:   solid red circle with ✕, red connector to here
 *
 * The component is purely presentational — it receives `stages` from the
 * usePipelineStages hook which derives state from live log lines.
 */

import { useEffect, useRef, useState } from 'react'

/* ── Duration formatter ──────────────────────────────────────────────────── */
function fmtDuration(ms) {
  if (!ms) return null
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

/* ── Stage node ──────────────────────────────────────────────────────────── */
function StageNode({ stage, isLast }) {
  const { label, status, duration, startedAt } = stage
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (status !== 'running' || !startedAt) return
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 500)
    return () => clearInterval(id)
  }, [status, startedAt])

  const colors = {
    waiting: {
      ring:   '#e2dfd8',
      fill:   'var(--bg-panel)',
      text:   'var(--text-tertiary)',
      label:  'var(--text-tertiary)',
      line:   '#e2dfd8',
    },
    running: {
      ring:   '#3b82f6',
      fill:   '#dbeafe',
      text:   '#1d4ed8',
      label:  'var(--text-primary)',
      line:   '#bfdbfe',
    },
    success: {
      ring:   '#22c55e',
      fill:   '#dcfce7',
      text:   '#166534',
      label:  'var(--text-primary)',
      line:   '#86efac',
    },
    failed: {
      ring:   '#ef4444',
      fill:   '#fee2e2',
      text:   '#991b1b',
      label:  'var(--text-primary)',
      line:   '#fca5a5',
    },
  }

  const c = colors[status] ?? colors.waiting

  const icons = {
    waiting: <span style={{ fontSize: '10px', color: c.text }}>○</span>,
    running: <SpinnerIcon color={c.text} />,
    success: <span style={{ fontSize: '11px', color: c.text, fontWeight: 700 }}>✓</span>,
    failed:  <span style={{ fontSize: '11px', color: c.text, fontWeight: 700 }}>✕</span>,
  }

  const durationText = status === 'running'
    ? fmtDuration(elapsed)
    : fmtDuration(duration)

  return (
    <div style={{ display: 'flex', alignItems: 'center', flex: isLast ? '0 0 auto' : '1 1 0' }}>
      {/* Node */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
        {/* Circle */}
        <div style={{
          position:       'relative',
          width:          '36px',
          height:         '36px',
          borderRadius:   '50%',
          background:     c.fill,
          border:         `2px solid ${c.ring}`,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          transition:     'all 350ms var(--ease-out-expo)',
          boxShadow:      status === 'running'
            ? `0 0 0 4px ${c.ring}28`
            : status === 'success'
            ? `0 2px 8px ${c.ring}40`
            : 'none',
          animation:      status === 'running' ? 'stagePulse 1.5s ease-in-out infinite' : undefined,
        }}>
          {icons[status] ?? icons.waiting}

          {/* Success fill animation */}
          {status === 'success' && (
            <div style={{
              position:     'absolute',
              inset:        0,
              borderRadius: '50%',
              background:   c.ring,
              opacity:      0.12,
              animation:    'scaleIn 300ms var(--ease-spring) both',
            }} />
          )}
        </div>

        {/* Label */}
        <div style={{
          fontSize:    '10px',
          fontWeight:  status === 'running' ? 600 : 500,
          color:       c.label,
          letterSpacing: '0.02em',
          textAlign:   'center',
          whiteSpace:  'nowrap',
          transition:  'color 300ms ease',
        }}>
          {label}
        </div>

        {/* Duration */}
        <div style={{
          fontSize:   '9px',
          fontFamily: 'var(--font-mono)',
          color:      status === 'running' ? '#3b82f6' : 'var(--text-tertiary)',
          height:     '12px',
          transition: 'opacity 300ms ease',
          opacity:    durationText ? 1 : 0,
        }}>
          {durationText ?? ''}
        </div>
      </div>

      {/* Connector line */}
      {!isLast && (
        <div style={{
          flex:       1,
          height:     '2px',
          marginBottom: '26px',  // align with circle centre
          background: status === 'success'
            ? `linear-gradient(90deg, ${c.line}, ${c.line})`
            : status === 'running'
            ? `linear-gradient(90deg, ${c.line} 0%, #e2dfd8 100%)`
            : '#e2dfd8',
          transition:  'background 400ms ease',
          position:    'relative',
          overflow:    'hidden',
        }}>
          {/* Running shimmer on connector */}
          {status === 'running' && (
            <div style={{
              position:   'absolute',
              inset:      0,
              background: 'linear-gradient(90deg, transparent 0%, rgba(59,130,246,0.5) 50%, transparent 100%)',
              animation:  'connectorShimmer 1.5s linear infinite',
            }} />
          )}
        </div>
      )}
    </div>
  )
}

/* ── Spinner ─────────────────────────────────────────────────────────────── */
function SpinnerIcon({ color }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
      style={{ animation: 'spin 0.8s linear infinite' }}>
      <circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="2"
        strokeLinecap="round" strokeDasharray="26" strokeDashoffset="8" />
    </svg>
  )
}

/* ── Main export ─────────────────────────────────────────────────────────── */
export function PipelineStages({ stages, buildStatus }) {
  if (!stages || stages.length === 0) return null

  // Filter out 'queued' stage from display when build is running/done
  const displayStages = buildStatus === 'queued'
    ? stages.slice(0, 1)  // just show queued
    : stages.slice(1)      // show clone → complete

  return (
    <div style={{
      padding:      '16px 20px 8px',
      background:   'var(--bg-panel-alt)',
      borderBottom: '1px solid var(--border-subtle)',
    }}>
      <div style={{
        fontSize:    '10px',
        fontWeight:  600,
        color:       'var(--text-tertiary)',
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
        marginBottom: '12px',
      }}>
        Pipeline Stages
      </div>

      <div style={{
        display:    'flex',
        alignItems: 'flex-start',
        gap:        0,
        overflowX:  'auto',
        paddingBottom: '4px',
      }}>
        {displayStages.map((stage, i) => (
          <StageNode
            key={stage.id}
            stage={stage}
            isLast={i === displayStages.length - 1}
          />
        ))}
      </div>
    </div>
  )
}