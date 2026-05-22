import { useState } from 'react'

// ── Phase 2: added Repos nav item ─────────────────────────────────────────────
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: GridIcon   },
  { id: 'builds',    label: 'Builds',    icon: BuildsIcon },
  { id: 'repos',     label: 'Repos',     icon: ReposIcon  },
  { id: 'settings',  label: 'Settings',  icon: GearIcon   },
]

export function Sidebar({ activePage, onNavigate, user = null, onLogout = () => {} }) {
  return (
    <aside style={{
      position: 'fixed', top: 0, left: 0,
      width: 'var(--sidebar-width)', height: '100vh',
      background: 'var(--bg-panel)',
      borderRight: '1px solid var(--border-subtle)',
      display: 'flex', flexDirection: 'column',
      zIndex: 100,
      boxShadow: '2px 0 20px rgba(0,0,0,0.4)',
    }}>

      {/* Logo */}
      <div style={{
        height: 'var(--topbar-height)',
        display: 'flex', alignItems: 'center',
        padding: '0 20px',
        borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '30px', height: '30px', borderRadius: '8px',
            background: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, boxShadow: '0 0 16px rgba(0,255,136,0.3)',
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M2 8h8M2 12h5" stroke="#080b0f" strokeWidth="2" strokeLinecap="round"/>
              <circle cx="13" cy="8" r="2" fill="#080b0f"/>
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.2, fontFamily: 'var(--font-mono)' }}>
              OpsPilot
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', letterSpacing: '0.05em', fontFamily: 'var(--font-mono)' }}>
              CI/CD Platform
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ padding: '12px 10px', flex: 1 }}>
        <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '0 10px 8px', fontFamily: 'var(--font-mono)' }}>
          Menu
        </div>
        {NAV.map(({ id, label, icon: Icon }) => {
          const active = activePage === id
          return (
            <button key={id} onClick={() => onNavigate?.(id)}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                width: '100%', padding: '9px 10px',
                borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer',
                fontSize: '13px', fontFamily: 'var(--font-mono)',
                fontWeight: active ? 600 : 400,
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                background: active ? 'rgba(0,255,136,0.08)' : 'transparent',
                transition: 'all var(--duration-fast) ease',
                textAlign: 'left', marginBottom: '2px',
                boxShadow: active ? 'inset 0 0 0 1px rgba(0,255,136,0.15)' : 'none',
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
            >
              <Icon active={active} />
              {label}
            </button>
          )
        })}
      </nav>

      {/* User identity + logout */}
      {user && (
        <div style={{
          padding: '12px 16px', borderTop: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', gap: '10px',
        }}>
          {user.avatar_url ? (
            <img src={user.avatar_url} alt={user.github_login}
              style={{ width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0 }} />
          ) : (
            <div style={{
              width: '28px', height: '28px', borderRadius: '50%',
              background: 'rgba(0,255,136,0.15)', border: '1px solid rgba(0,255,136,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '12px', fontWeight: 700, color: 'var(--accent)', flexShrink: 0,
            }}>
              {user.github_login[0].toUpperCase()}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.github_name ?? user.github_login}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              @{user.github_login}
            </div>
          </div>
          <button onClick={onLogout} title="Log out" style={{
            background: 'none', border: '1px solid var(--border-subtle)',
            borderRadius: '6px', color: 'var(--text-tertiary)', cursor: 'pointer',
            fontSize: '13px', width: '28px', height: '28px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, transition: 'all 0.15s',
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#f85149'; e.currentTarget.style.color = '#f85149' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.color = 'var(--text-tertiary)' }}
          >⏻</button>
        </div>
      )}

      {!user && (
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-subtle)', fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
          v1.0.0 · Phase 2
        </div>
      )}
    </aside>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────
function GridIcon({ active }) {
  const c = active ? 'var(--accent)' : 'var(--text-tertiary)'
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <rect x="1" y="1" width="5.5" height="5.5" rx="1.5" stroke={c} strokeWidth="1.5"/>
      <rect x="8.5" y="1" width="5.5" height="5.5" rx="1.5" stroke={c} strokeWidth="1.5"/>
      <rect x="1" y="8.5" width="5.5" height="5.5" rx="1.5" stroke={c} strokeWidth="1.5"/>
      <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1.5" stroke={c} strokeWidth="1.5"/>
    </svg>
  )
}
function BuildsIcon({ active }) {
  const c = active ? 'var(--accent)' : 'var(--text-tertiary)'
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M2 3.5h11M2 7.5h7M2 11.5h9" stroke={c} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}
function ReposIcon({ active }) {
  const c = active ? 'var(--accent)' : 'var(--text-tertiary)'
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M3 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke={c} strokeWidth="1.5"/>
      <path d="M5 2v11M8 5h3M8 8h3" stroke={c} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}
function GearIcon({ active }) {
  const c = active ? 'var(--accent)' : 'var(--text-tertiary)'
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <circle cx="7.5" cy="7.5" r="2" stroke={c} strokeWidth="1.5"/>
      <path d="M7.5 1v1.5M7.5 12.5V14M1 7.5h1.5M12.5 7.5H14M2.9 2.9l1.06 1.06M11.04 11.04l1.06 1.06M2.9 12.1l1.06-1.06M11.04 3.96l1.06-1.06"
            stroke={c} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}