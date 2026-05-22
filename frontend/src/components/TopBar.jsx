import { useEffect, useState } from 'react'

export function TopBar({ connected, builds }) {
  const running = builds.filter(b => b.status === 'running').length
  const failed  = builds.filter(b => b.status === 'failed').length

  return (
    <header style={{
      position: 'fixed', top: 0, left: 'var(--sidebar-width)', right: 0,
      height: 'var(--topbar-height)',
      background: 'rgba(8,11,15,0.85)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      borderBottom: '1px solid var(--border-subtle)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 28px', zIndex: 90,
    }}>
      <div>
        <h1 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em', fontFamily: 'var(--font-mono)' }}>
          Build Dashboard
        </h1>
        <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '1px', fontFamily: 'var(--font-mono)' }}>
          Real-time CI/CD pipeline monitor
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {running > 0 && (
          <StatChip label={`${running} running`} color="var(--status-running-fg)" bg="var(--status-running-bg)" pulse />
        )}
        {failed > 0 && (
          <StatChip label={`${failed} failed`} color="var(--status-failed-fg)" bg="var(--status-failed-bg)" />
        )}
        <ConnectionPill connected={connected} />
      </div>
    </header>
  )
}

function StatChip({ label, color, bg, pulse }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '4px 10px', borderRadius: '99px',
      background: bg, fontSize: '11px', fontWeight: 500,
      color, fontFamily: 'var(--font-mono)',
      border: `1px solid ${color}30`,
    }}>
      {pulse && <span style={{ display: 'block', width: '6px', height: '6px', borderRadius: '50%', background: color, animation: 'breathe 1.1s ease-in-out infinite' }}/>}
      {label}
    </div>
  )
}

function ConnectionPill({ connected }) {
  const [flash, setFlash] = useState(false)
  const [prev,  setPrev]  = useState(connected)

  useEffect(() => {
    if (prev !== connected) {
      setFlash(true)
      setTimeout(() => setFlash(false), 1000)
      setPrev(connected)
    }
  }, [connected, prev])

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '5px 12px', borderRadius: '99px',
      border: connected ? '1px solid rgba(0,255,136,0.2)' : '1px solid var(--border-subtle)',
      background: connected ? 'rgba(0,255,136,0.06)' : 'rgba(255,255,255,0.03)',
      fontSize: '11px', fontWeight: 500,
      color: connected ? 'var(--status-success-fg)' : 'var(--text-tertiary)',
      transition: 'all var(--duration-base) ease',
      fontFamily: 'var(--font-mono)',
      boxShadow: flash ? '0 0 0 3px rgba(0,255,136,0.1)' : 'none',
    }}>
      <span style={{
        width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
        background: connected ? 'var(--status-success-dot)' : 'var(--border-strong)',
        animation: connected ? 'breathe 2s ease-in-out infinite' : undefined,
        transition: 'background var(--duration-base) ease',
        boxShadow: connected ? '0 0 6px rgba(0,255,136,0.6)' : 'none',
      }} />
      {connected ? 'Live' : 'Offline'}
    </div>
  )
}