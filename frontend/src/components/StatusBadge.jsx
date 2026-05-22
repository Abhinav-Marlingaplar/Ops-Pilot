/**
 * components/StatusBadge.jsx
 *
 * Renders a coloured pill badge for a build status.
 * On every status change the badge fires a "pulse ripple" that radiates
 * outward — implemented via a CSS animation triggered by re-keying the
 * ripple element whenever `status` changes.
 */

import { useEffect, useRef, useState } from 'react'

const CONFIG = {
  queued:  { label: 'Queued',  icon: '○', var: 'queued'  },
  running: { label: 'Running', icon: '◉', var: 'running' },
  success: { label: 'Success', icon: '●', var: 'success' },
  failed:  { label: 'Failed',  icon: '✕', var: 'failed'  },
}

export function StatusBadge({ status, size = 'md', showPulse = true }) {
  const cfg            = CONFIG[status] ?? CONFIG.queued
  const [pulseKey, setPulseKey] = useState(0)
  const prevStatus     = useRef(status)

  useEffect(() => {
    if (prevStatus.current !== status) {
      setPulseKey(k => k + 1)
      prevStatus.current = status
    }
  }, [status])

  const isRunning = status === 'running'
  const sizeStyles = size === 'sm'
    ? { fontSize: '11px', padding: '2px 8px', gap: '5px' }
    : { fontSize: '12px', padding: '4px 10px', gap: '6px' }

  return (
    <span style={{
      position:       'relative',
      display:        'inline-flex',
      alignItems:     'center',
      gap:            sizeStyles.gap,
      padding:        sizeStyles.padding,
      fontSize:       sizeStyles.fontSize,
      fontFamily:     'var(--font-ui)',
      fontWeight:     500,
      letterSpacing:  '0.02em',
      borderRadius:   '99px',
      color:          `var(--status-${cfg.var}-fg)`,
      background:     `var(--status-${cfg.var}-bg)`,
      whiteSpace:     'nowrap',
      userSelect:     'none',
    }}>

      {/* Status dot — spins when running */}
      <span style={{
        position:     'relative',
        display:      'inline-flex',
        alignItems:   'center',
        justifyContent: 'center',
        width:        '7px',
        height:       '7px',
        flexShrink:   0,
      }}>
        <span style={{
          display:       'block',
          width:         '7px',
          height:        '7px',
          borderRadius:  '50%',
          background:    `var(--status-${cfg.var}-dot)`,
          animation:     isRunning
            ? 'breathe 1.2s ease-in-out infinite'
            : undefined,
        }} />

        {/* Pulse ripple — fires on status change */}
        {showPulse && (
          <span
            key={pulseKey}
            style={{
              position:     'absolute',
              inset:        '-4px',
              borderRadius: '50%',
              color:        `var(--status-${cfg.var}-dot)`,
              animation:    pulseKey > 0
                ? 'statusPulse 600ms ease-out forwards'
                : undefined,
              pointerEvents: 'none',
            }}
          />
        )}
      </span>

      {cfg.label}
    </span>
  )
}