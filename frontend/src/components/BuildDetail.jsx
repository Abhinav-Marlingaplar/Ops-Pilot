/**
 * components/BuildDetail.jsx  (Enhancement 1 — updated)
 *
 * Adds:
 *  1. PipelineStages tracker at the top
 *  2. Analytics cards: build duration, log line count, status
 *  3. Log search / filter
 *  4. Download logs button
 *  5. Line numbers in terminal
 *  6. Auto-scroll with manual override
 */

import { useEffect, useRef, useState } from 'react'
import { useBuildDetail }    from '../hooks/useBuildDetail'
import { usePipelineStages } from '../hooks/usePipelineStages'
import { StatusBadge }       from './StatusBadge'
import { PipelineStages }    from './PipelineStages'

const ANSI_RE = /\x1b\[[0-9;]*m/g
const stripAnsi = s => s.replace(ANSI_RE, '')

function fmtDuration(ms) {
  if (!ms || ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function MetaRow({ label, value, mono }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      alignItems: 'flex-start', gap: '12px',
      padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: '12px',
    }}>
      <span style={{ color: 'var(--text-tertiary)', fontWeight: 500, flexShrink: 0, width: '90px' }}>
        {label}
      </span>
      <span style={{
        color: 'var(--text-primary)', fontFamily: mono ? 'var(--font-mono)' : 'var(--font-ui)',
        textAlign: 'right', wordBreak: 'break-all', fontSize: mono ? '11px' : '12px',
      }}>
        {value ?? '—'}
      </span>
    </div>
  )
}

function AnalyticsCards({ build, logLines }) {
  const totalDuration = build?.updated_at && build?.created_at
    ? new Date(build.updated_at) - new Date(build.created_at) : null

  const cards = [
    { label: 'Duration',   value: fmtDuration(totalDuration), icon: '⏱', color: 'var(--accent)' },
    { label: 'Log Lines',  value: logLines.length.toLocaleString(), icon: '≡', color: 'var(--status-running-dot)' },
    { label: 'Worker',     value: build?.worker_id ?? '—', icon: '◈', color: 'var(--status-success-dot)' },
  ]

  return (
    <div style={{ display: 'flex', gap: '10px' }}>
      {cards.map(card => (
        <div key={card.label} style={{
          flex: '1 1 0', background: 'var(--bg-panel)',
          border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
          padding: '12px 14px', boxShadow: 'var(--shadow-sm)',
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: '12px', right: '12px',
            height: '2px', background: card.color, opacity: 0.6,
            borderRadius: '0 0 4px 4px',
          }} />
          <div style={{ fontSize: '11px', color: card.color, marginBottom: '4px' }}>
            {card.icon}
          </div>
          <div style={{
            fontSize: '14px', fontWeight: 700, fontFamily: 'var(--font-mono)',
            color: 'var(--text-primary)', letterSpacing: '-0.02em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {card.value}
          </div>
          <div style={{
            fontSize: '9px', color: 'var(--text-tertiary)', fontWeight: 600,
            letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: '3px',
          }}>
            {card.label}
          </div>
        </div>
      ))}
    </div>
  )
}

const termBtnStyle = {
  fontSize: '10px', fontFamily: 'var(--font-mono)',
  color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.10)', borderRadius: '4px',
  padding: '3px 8px', cursor: 'pointer',
}

function EnhancedTerminal({ logLines, status, buildId }) {
  const bodyRef = useRef(null)
  const [search,     setSearch]     = useState('')
  const [copied,     setCopied]     = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)

  const isRunning  = status === 'running'
  const isComplete = status === 'success' || status === 'failed'

  useEffect(() => {
    if (autoScroll && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [logLines.length, autoScroll])

  const handleScroll = () => {
    const el = bodyRef.current
    if (!el) return
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(logLines.map(l => stripAnsi(l.line)).join('\n'))
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) })
  }

  const handleDownload = () => {
    const blob = new Blob([logLines.map(l => stripAnsi(l.line)).join('\n')], { type: 'text/plain' })
    const a    = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob), download: `build-${buildId}.log`,
    })
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const filtered = search.trim()
    ? logLines.filter(l => stripAnsi(l.line).toLowerCase().includes(search.toLowerCase()))
    : logLines

  const highlight = (text) => {
    if (!search.trim()) return text
    const idx = text.toLowerCase().indexOf(search.toLowerCase())
    if (idx === -1) return text
    return (<>{text.slice(0, idx)}<mark style={{ background: '#fde68a', color: '#1a1917', borderRadius: '2px' }}>{text.slice(idx, idx + search.length)}</mark>{text.slice(idx + search.length)}</>)
  }

  return (
    <div className="terminal">
      {/* Header */}
      <div className="terminal-header" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="terminal-dot red" /><span className="terminal-dot yellow" /><span className="terminal-dot green" />
          <span className="terminal-title" style={{ marginLeft: '8px' }}>build-{buildId}.log</span>
          {isRunning && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'var(--terminal-green)', fontFamily: 'var(--font-mono)' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--terminal-green)', animation: 'breathe 1s ease-in-out infinite', display: 'block' }} />
              LIVE
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', fontFamily: 'var(--font-mono)' }}>
            {filtered.length}/{logLines.length} lines
          </span>
          <button onClick={handleCopy}     style={termBtnStyle}>{copied ? '✓ Copied' : 'Copy'}</button>
          <button onClick={handleDownload} style={termBtnStyle}>↓ Download</button>
        </div>
      </div>

      {/* Search */}
      <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>⌕</span>
          <input
            type="text" placeholder="Search logs…" value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-sm)',
              padding: '5px 28px', fontSize: '11px', fontFamily: 'var(--font-mono)',
              color: 'var(--terminal-fg)', outline: 'none',
            }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '12px' }}>✕</button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="terminal-body" ref={bodyRef} onScroll={handleScroll} style={{ maxHeight: '380px' }}>
        {!autoScroll && isRunning && (
          <button onClick={() => { setAutoScroll(true); bodyRef.current.scrollTop = bodyRef.current.scrollHeight }}
            style={{ display: 'block', margin: '0 auto 8px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '99px', padding: '4px 12px', fontSize: '10px', color: '#93c5fd', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>
            ↓ Resume auto-scroll
          </button>
        )}

        {filtered.length === 0 && (
          <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: '12px' }}>
            {search ? `No lines matching "${search}"` : isRunning ? 'Waiting for log output…' : 'No logs available.'}
          </div>
        )}

        {filtered.map((entry, i) => {
          const raw = stripAnsi(entry.line)
          const isStderr  = entry.stream === 'stderr'
          const isStep    = raw.includes('── Step')
          const isSuccess = raw.includes('SUCCESS')
          const isFail    = raw.includes('FAILED')
          const isCmd     = raw.startsWith('$ ')
          let color = 'var(--terminal-fg)'
          if (isStderr)  color = 'var(--terminal-red)'
          if (isStep)    color = 'var(--terminal-cyan)'
          if (isSuccess) color = 'var(--terminal-green)'
          if (isFail)    color = 'var(--terminal-red)'
          if (isCmd)     color = 'var(--terminal-yellow)'

          return (
            <div key={entry.id ?? i} style={{ display: 'flex', gap: '12px', animation: 'logLineIn 120ms var(--ease-out-expo) both', animationDelay: `${Math.min(i * 4, 120)}ms`, lineHeight: 1.7 }}>
              <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.15)', userSelect: 'none', flexShrink: 0, minWidth: '28px', textAlign: 'right' }}>{i + 1}</span>
              <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontWeight: (isStep || isSuccess || isFail) ? 600 : 400 }}>
                {search ? highlight(raw) : raw}
              </span>
            </div>
          )
        })}

        {isRunning && <span className="terminal-cursor" />}
        {isComplete && logLines.length > 0 && (
          <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: '10px', color: status === 'success' ? 'var(--terminal-green)' : 'var(--terminal-red)', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>{status === 'success' ? '✓' : '✕'}</span>
            <span>Process exited with code {status === 'success' ? '0' : '1'}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export function BuildDetail({ buildId, socket, onClose }) {
  const { build, logLines, loading, error } = useBuildDetail(buildId, socket)
  const { stages } = usePipelineStages(logLines, build?.status ?? 'queued')

  if (!buildId) return null

  return (
    <div className="animate-slide-right" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>Build #{buildId}</h2>
          <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>Pipeline detail & live logs</p>
        </div>
        <button onClick={onClose} style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-medium)', background: 'var(--bg-panel)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '14px' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-panel-alt)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-panel)' }}>✕</button>
      </div>

      {/* Pipeline stages */}
      {build && !loading && (
        <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
          <PipelineStages stages={stages} buildStatus={build.status} />
        </div>
      )}

      {/* Analytics */}
      {build && !loading && <AnalyticsCards build={build} logLines={logLines} />}

      {/* Metadata */}
      <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '4px 16px', boxShadow: 'var(--shadow-sm)' }}>
        {loading && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <div className="skeleton" style={{ width: '70px', height: '13px' }} />
            <div className="skeleton" style={{ width: '120px', height: '13px' }} />
          </div>
        ))}
        {error && <p style={{ padding: '16px 0', color: 'var(--status-failed-fg)', fontSize: '12px' }}>Error: {error}</p>}
        {build && !loading && (
          <>
            <div style={{ padding: '12px 0 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <StatusBadge status={build.status} size="md" showPulse />
              {build.status === 'running' && <RunningBadge createdAt={build.created_at} />}
            </div>
            <MetaRow label="Repository" value={build.repository} mono />
            <MetaRow label="Branch"     value={build.branch}     mono />
            <MetaRow label="Commit"     value={build.commit}     mono />
            <MetaRow label="Started"    value={build.created_at ? new Date(build.created_at).toLocaleString() : null} />
            <MetaRow label="Updated"    value={build.updated_at ? new Date(build.updated_at).toLocaleString() : null} />
          </>
        )}
      </div>

      {/* Terminal */}
      <EnhancedTerminal logLines={logLines} status={build?.status ?? 'queued'} buildId={buildId} />
    </div>
  )
}

function RunningBadge({ createdAt }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - new Date(createdAt)) / 1000)), 1000)
    return () => clearInterval(id)
  }, [createdAt])
  const m = Math.floor(elapsed / 60), s = elapsed % 60
  return (
    <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--status-running-fg)', background: 'var(--status-running-bg)', padding: '3px 8px', borderRadius: '6px' }}>
      {m > 0 ? `${m}m ` : ''}{String(s).padStart(2, '0')}s elapsed
    </span>
  )
}