/**
 * components/LogTerminal.jsx
 *
 * Renders a macOS-style terminal window for build logs.
 * - Auto-scrolls to the bottom as new lines arrive
 * - Shows a blinking cursor while the build is running
 * - Colour-codes stderr lines red, ANSI escape markers stripped cleanly
 * - Copy-to-clipboard button in the header
 */

import { useEffect, useRef, useState } from 'react'

/* Strip ANSI escape codes for display (we keep bold/colour in terminal view
   but strip them for clipboard copy) */
const ANSI_RE = /\x1b\[[0-9;]*m/g

function stripAnsi(str) {
  return str.replace(ANSI_RE, '')
}

/**
 * Very light ANSI → JSX colouring.
 * We only need to handle what the runner actually emits:
 *   \x1b[36m  = cyan  (step headers)
 *   \x1b[32m  = green (success)
 *   \x1b[31m  = red   (failure / stderr marker)
 *   \x1b[1m   = bold
 *   \x1b[0m   = reset
 */
function AnsiLine({ raw }) {
  if (!raw.includes('\x1b[')) {
    return <>{raw}</>
  }

  const parts = []
  let remaining = raw
  let key = 0
  let currentStyle = {}

  const styleMap = {
    '31': { color: 'var(--terminal-red)' },
    '32': { color: 'var(--terminal-green)' },
    '36': { color: 'var(--terminal-cyan)' },
    '33': { color: 'var(--terminal-yellow)' },
    '1':  { fontWeight: '600' },
    '0':  {},
  }

  const segments = remaining.split(/(\x1b\[[0-9;]*m)/)
  segments.forEach(seg => {
    if (seg.startsWith('\x1b[')) {
      const code = seg.replace(/\x1b\[([0-9;]*)m/, '$1')
      if (code === '0' || code === '') {
        currentStyle = {}
      } else {
        code.split(';').forEach(c => {
          if (styleMap[c]) currentStyle = { ...currentStyle, ...styleMap[c] }
        })
      }
    } else if (seg) {
      parts.push(
        <span key={key++} style={currentStyle}>{seg}</span>
      )
    }
  })

  return <>{parts}</>
}

export function LogTerminal({ logLines, status, buildId }) {
  const bodyRef   = useRef(null)
  const [copied, setCopied] = useState(false)

  const isRunning  = status === 'running'
  const isComplete = status === 'success' || status === 'failed'

  // Auto-scroll to bottom whenever new lines arrive
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [logLines.length])

  const handleCopy = () => {
    const text = logLines.map(l => stripAnsi(l.line)).join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  return (
    <div className="terminal animate-slide-right">
      {/* macOS-style traffic lights header */}
      <div className="terminal-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="terminal-dot red"   />
          <span className="terminal-dot yellow" />
          <span className="terminal-dot green"  />
          <span className="terminal-title" style={{ marginLeft: '10px' }}>
            {buildId ? `build-${buildId}.log` : 'build.log'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Live indicator */}
          {isRunning && (
            <span style={{
              display:    'flex',
              alignItems: 'center',
              gap:        '5px',
              fontSize:   '10px',
              color:      'var(--terminal-green)',
              fontFamily: 'var(--font-mono)',
            }}>
              <span style={{
                width: '6px', height: '6px',
                borderRadius: '50%',
                background: 'var(--terminal-green)',
                animation: 'breathe 1s ease-in-out infinite',
                display: 'block',
              }}/>
              LIVE
            </span>
          )}

          {/* Line count */}
          <span style={{
            fontSize:   '10px',
            color:      'rgba(255,255,255,0.25)',
            fontFamily: 'var(--font-mono)',
          }}>
            {logLines.length} lines
          </span>

          {/* Copy button */}
          <button
            onClick={handleCopy}
            style={{
              fontSize:   '10px',
              fontFamily: 'var(--font-mono)',
              color:      copied ? 'var(--terminal-green)' : 'rgba(255,255,255,0.35)',
              background: 'rgba(255,255,255,0.06)',
              border:     '1px solid rgba(255,255,255,0.10)',
              borderRadius: '4px',
              padding:    '3px 8px',
              cursor:     'pointer',
              transition: 'color 0.2s ease',
            }}
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Log body */}
      <div className="terminal-body" ref={bodyRef}>
        {logLines.length === 0 && (
          <div style={{ color: 'rgba(255,255,255,0.2)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
            {isRunning
              ? 'Waiting for log output…'
              : 'No logs available for this build.'}
          </div>
        )}

        {logLines.map((entry, i) => {
          const isStderr  = entry.stream === 'stderr'
          const isMarker  = entry.line.includes('── Step') || entry.line.includes('===')
          const isSuccess = entry.line.includes('SUCCESS')
          const isFail    = entry.line.includes('FAILED') || entry.line.includes('PIPELINE FAILED')

          let className = 'terminal-line stdout'
          if (isStderr)  className = 'terminal-line stderr'
          if (isMarker)  className = 'terminal-line marker'
          if (isSuccess) className = 'terminal-line success-marker'
          if (isFail)    className = 'terminal-line fail-marker'

          return (
            <span
              key={entry.id ?? i}
              className={className}
              style={{ animationDelay: `${Math.min(i * 8, 200)}ms` }}
            >
              <AnsiLine raw={stripAnsi(entry.line)} />
              {'\n'}
            </span>
          )
        })}

        {/* Blinking cursor while running */}
        {isRunning && <span className="terminal-cursor" />}

        {/* Completion stamp */}
        {isComplete && logLines.length > 0 && (
          <div style={{
            marginTop:  '12px',
            paddingTop: '12px',
            borderTop:  '1px solid rgba(255,255,255,0.06)',
            fontSize:   '10px',
            color:      status === 'success' ? 'var(--terminal-green)' : 'var(--terminal-red)',
            fontFamily: 'var(--font-mono)',
            display:    'flex',
            alignItems: 'center',
            gap:        '6px',
          }}>
            <span>{status === 'success' ? '✓' : '✕'}</span>
            <span>Process exited with code {status === 'success' ? '0' : '1'}</span>
          </div>
        )}
      </div>
    </div>
  )
}