import { useEffect, useRef, useState } from 'react'

function useCountUp(target, duration = 600) {
  const [value, setValue] = useState(0)
  const frameRef = useRef(null)
  useEffect(() => {
    const start = performance.now()
    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1)
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress)
      setValue(Math.round(target * eased))
      if (progress < 1) frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [target, duration])
  return value
}

function StatCard({ label, value, accent, icon, delay }) {
  const displayed = useCountUp(value)
  return (
    <div className={`animate-slide-up delay-${delay}`}
      style={{
        flex: '1 1 0', minWidth: '120px',
        background: 'var(--bg-panel)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 22px',
        boxShadow: 'var(--shadow-sm)',
        transition: 'box-shadow var(--duration-base) ease, transform var(--duration-base) ease, border-color var(--duration-base) ease',
        cursor: 'default', position: 'relative', overflow: 'hidden',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = `var(--shadow-md), 0 0 20px ${accent}18`
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.borderColor = `${accent}30`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = 'var(--shadow-sm)'
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.borderColor = 'var(--border-subtle)'
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: '20px', right: '20px', height: '1px', background: accent, opacity: 0.5 }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: accent, letterSpacing: '-0.03em', lineHeight: 1, fontFamily: 'var(--font-mono)' }}>
            {displayed}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '6px', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
            {label}
          </div>
        </div>
        <div style={{ width: '34px', height: '34px', borderRadius: 'var(--radius-md)', background: `${accent}10`, border: `1px solid ${accent}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {icon}
        </div>
      </div>
    </div>
  )
}

export function StatsRow({ builds }) {
  const total   = builds.length
  const running = builds.filter(b => b.status === 'running').length
  const success = builds.filter(b => b.status === 'success').length
  const failed  = builds.filter(b => b.status === 'failed').length

  const stats = [
    { label: 'Total Builds', value: total,   accent: '#4f9eff', delay: '0',
      icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1.5" stroke="#4f9eff" strokeWidth="1.5"/><rect x="9" y="1" width="6" height="6" rx="1.5" stroke="#4f9eff" strokeWidth="1.5"/><rect x="1" y="9" width="6" height="6" rx="1.5" stroke="#4f9eff" strokeWidth="1.5"/><rect x="9" y="9" width="6" height="6" rx="1.5" stroke="#4f9eff" strokeWidth="1.5"/></svg> },
    { label: 'Running',      value: running, accent: '#4f9eff', delay: '100',
      icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="#4f9eff" strokeWidth="1.5"/><path d="M6 5.5l5 2.5-5 2.5V5.5z" fill="#4f9eff"/></svg> },
    { label: 'Succeeded',    value: success, accent: '#00ff88', delay: '200',
      icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="#00ff88" strokeWidth="1.5"/><path d="M5 8l2 2 4-4" stroke="#00ff88" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> },
    { label: 'Failed',       value: failed,  accent: '#ff5f5f', delay: '300',
      icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="#ff5f5f" strokeWidth="1.5"/><path d="M6 6l4 4M10 6l-4 4" stroke="#ff5f5f" strokeWidth="1.5" strokeLinecap="round"/></svg> },
  ]

  return (
    <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
      {stats.map(s => <StatCard key={s.label} {...s} />)}
    </div>
  )
}