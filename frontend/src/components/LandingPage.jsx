/**
 * frontend/src/components/LandingPage.jsx
 *
 * Full React conversion of landing/index.html.
 * Replaces the external HTML file entirely — no more /landing.html route,
 * no Vercel rewrite hacks, no DOMContentLoaded timing issues.
 *
 * Animation strategy:
 *   - Hero elements: CSS animation classes applied on mount (fade-up + delays)
 *   - Scroll reveal: IntersectionObserver via useEffect + useRef
 *   - Stat counters: IntersectionObserver triggers a counting interval
 *   - Pipeline visualizer: useEffect interval loop, cleans up on unmount
 */

import { useEffect, useRef, useState, useCallback } from 'react';

// ─── Pipeline visualizer data ─────────────────────────────────────────────────

const PIPELINE_STAGES = [
  { id: 'clone',    label: 'Clone',    icon: '⎋' },
  { id: 'checkout', label: 'Checkout', icon: '⌥' },
  { id: 'install',  label: 'Install',  icon: '⬇' },
  { id: 'test',     label: 'Test',     icon: '⚗' },
  { id: 'docker',   label: 'Docker',   icon: '◈' },
  { id: 'complete', label: 'Complete', icon: '✓' },
];

const STAGE_DURATIONS = [2200, 800, 3800, 4500, 1200, 600];

const STAGE_LOGS = [
  [{ text: '── Step 1/5: Clone repository ──', type: 'info' }, { text: '$ git clone --depth=1 --branch master ...', type: 'cmd' }],
  [{ text: '── Step 2/5: Using HEAD ──', type: 'info' }],
  [{ text: '── Step 3/5: npm install ──', type: 'info' }, { text: '$ npm install --prefer-offline', type: 'cmd' }],
  [{ text: '── Step 4/5: npm test ──', type: 'info' }, { text: '✓ 1247 tests passing', type: 'success' }],
  [{ text: '── Step 5/5: Docker build ──', type: 'info' }, { text: '$ docker build -t cicd-build ...', type: 'cmd' }],
  [],
];

// ─── Hooks ────────────────────────────────────────────────────────────────────

/** Attach IntersectionObserver to all .reveal elements inside a container ref */
function useScrollReveal(containerRef) {
  useEffect(() => {
    // Double-rAF: wait for two paint cycles before attaching the observer.
    // One rAF is enough for layout, but the second guarantees the browser has
    // also committed the initial opacity:0 state from the .lp-reveal rule.
    // Without this, getBoundingClientRect() sees everything at top:0 and
    // immediately adds lp-visible before the transition has registered,
    // so elements appear fully visible with no animation on first load.
    let rafId;
    const setup = () => {
      const container = containerRef?.current ?? document;
      const elements  = container.querySelectorAll('.lp-reveal');

      const observer = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            e.target.classList.add('lp-visible');
            observer.unobserve(e.target);
          }
        });
      }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

      elements.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) {
          // Already in viewport — add visible on next frame so the
          // transition fires (element starts invisible, then fades in).
          requestAnimationFrame(() => el.classList.add('lp-visible'));
        } else {
          observer.observe(el);
        }
      });

      return () => observer.disconnect();
    };

    // First rAF: layout complete. Second rAF: paint complete.
    let cleanup = () => {};
    rafId = requestAnimationFrame(() => {
      rafId = requestAnimationFrame(() => {
        cleanup = setup() || (() => {});
      });
    });

    return () => { cancelAnimationFrame(rafId); cleanup(); };
  }, [containerRef]);
}

/** Count-up animation for stat numbers */
function useCountUp(ref, target, enabled) {
  useEffect(() => {
    if (!enabled || !ref.current || isNaN(target)) return;
    let current = 0;
    const step  = Math.max(1, Math.floor(target / 40));
    const id    = setInterval(() => {
      current = Math.min(current + step, target);
      if (ref.current) ref.current.textContent = current;
      if (current >= target) clearInterval(id);
    }, 35);
    return () => clearInterval(id);
  }, [enabled, target, ref]);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ target, label, prefix = '', suffix = '' }) {
  const ref      = useRef(null);
  const [vis, setVis] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setVis(true); obs.disconnect(); }
    }, { threshold: 0.3 });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  useCountUp(ref, target, vis && target != null);

  return (
    <div className="lp-stat-card">
      <div className="lp-stat-number" ref={ref}>
        {target != null ? (vis ? target : 0) : `${prefix}${suffix}`}
      </div>
      <div className="lp-stat-label">{label}</div>
    </div>
  );
}

function PipelineVisualizer() {
  const [stageStates,  setStageStates]  = useState(Array(PIPELINE_STAGES.length).fill('waiting'));
  const [stageDurs,    setStageDurs]    = useState(Array(PIPELINE_STAGES.length).fill(null));
  const [logLines,     setLogLines]     = useState([]);
  const [statusText,   setStatusText]   = useState('Running');
  const [statusColor,  setStatusColor]  = useState('var(--lp-green)');
  const currentStageRef = useRef(0);
  const timerRef        = useRef(null);

  const addLog = useCallback((text, type) => {
    setLogLines(prev => {
      const next = [...prev, { text, type, key: Date.now() + Math.random() }];
      return next.slice(-5);
    });
  }, []);

  const reset = useCallback(() => {
    currentStageRef.current = 0;
    setStageStates(Array(PIPELINE_STAGES.length).fill('waiting'));
    setStageDurs(Array(PIPELINE_STAGES.length).fill(null));
    setLogLines([]);
    setStatusText('Running');
    setStatusColor('var(--lp-green)');
  }, []);

  const advance = useCallback(() => {
    const idx = currentStageRef.current;

    if (idx > PIPELINE_STAGES.length) {
      // restart
      timerRef.current = setTimeout(() => { reset(); }, 100);
      return;
    }

    setStageStates(prev => {
      const next = [...prev];
      if (idx > 0) {
        next[idx - 1] = 'success';
        setStageDurs(d => {
          const nd = [...d];
          nd[idx - 1] = (STAGE_DURATIONS[idx - 1] / 1000).toFixed(1) + 's';
          return nd;
        });
      }
      if (idx < PIPELINE_STAGES.length) next[idx] = 'running';
      return next;
    });

    if (idx < PIPELINE_STAGES.length) {
      const lines = STAGE_LOGS[idx] || [];
      lines.forEach((line, i) => {
        setTimeout(() => addLog(line.text, line.type), i * 400);
      });
      currentStageRef.current = idx + 1;
      timerRef.current = setTimeout(advance, STAGE_DURATIONS[idx] || 1000);
    } else {
      // all done
      setStageStates(Array(PIPELINE_STAGES.length).fill('success'));
      setStatusText('Success');
      setStatusColor('var(--lp-green)');
      addLog('=== Pipeline completed: SUCCESS ===', 'success');
      currentStageRef.current = idx + 1;
      timerRef.current = setTimeout(() => { reset(); timerRef.current = setTimeout(advance, 800); }, 3000);
    }
  }, [addLog, reset]);

  useEffect(() => {
    timerRef.current = setTimeout(advance, 1200);
    return () => clearTimeout(timerRef.current);
  }, [advance]);

  // Re-run after reset
  useEffect(() => {
    if (stageStates.every(s => s === 'waiting') && currentStageRef.current === 0) {
      timerRef.current = setTimeout(advance, 800);
    }
  }, [stageStates, advance]);

  return (
    <div className="lp-pipeline-container">
      <div className="lp-pipeline-titlebar">
        <span className="lp-tl-dot lp-tl-red" />
        <span className="lp-tl-dot lp-tl-yellow" />
        <span className="lp-tl-dot lp-tl-green" />
        <span className="lp-tl-title">PIPELINE · expressjs/express · master</span>
        <span className="lp-tl-status" style={{ color: statusColor }}>{statusText}</span>
      </div>

      <div className="lp-pipeline-stages-viz">
        {PIPELINE_STAGES.map((stage, i) => {
          const state  = stageStates[i] || 'waiting';
          const isLast = i === PIPELINE_STAGES.length - 1;
          return (
            <div key={stage.id} style={{ display: 'contents' }}>
              <div className={`lp-viz-stage${state === 'running' ? ' lp-active' : state === 'success' ? ' lp-done' : ''}`}>
                <div className={`lp-viz-node lp-viz-node--${state}`}>{stage.icon}</div>
                <div className="lp-viz-label">{stage.label}</div>
                <div className="lp-viz-duration">{state === 'success' && stageDurs[i] ? stageDurs[i] : '\u00a0'}</div>
              </div>
              {!isLast && (
                <div className={`lp-viz-connector${state === 'running' ? ' lp-active' : state === 'success' ? ' lp-done' : ''}`} />
              )}
            </div>
          );
        })}
      </div>

      <div className="lp-pipeline-log">
        {logLines.map((line) => (
          <div key={line.key} className="lp-log-line lp-log-line--visible">
            <span className="lp-log-num">{logLines.indexOf(line) + 1}</span>
            <span className={`lp-log-text lp-log-text--${line.type}`}>{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function LandingPage() {
  const containerRef = useRef(null);
  useScrollReveal(containerRef);

  const TECH = [
    { label: 'Node.js 20',       color: '#339933' },
    { label: 'React 18',         color: '#61dafb' },
    { label: 'Kubernetes 1.35',  color: '#326ce5' },
    { label: 'Docker CE',        color: '#2496ed' },
    { label: 'RabbitMQ 3',       color: '#ff6600' },
    { label: 'PostgreSQL 15',    color: '#4169e1' },
    { label: 'Socket.IO 4',      color: '#010101' },
    { label: 'Vite 5',           color: '#646cff' },
    { label: 'Nginx 1.27',       color: '#009639' },
    { label: 'JSON Web Tokens',  color: '#f59e0b' },
    { label: 'dumb-init',        color: '#00ff88' },
    { label: 'amqplib',          color: '#8b949e' },
  ];

  return (
    <>
      <style>{LANDING_CSS}</style>
      <div className="lp-root" ref={containerRef}>

        {/* ── Nav ── */}
        <nav className="lp-nav">
          <div className="lp-nav-logo">
            <div className="lp-nav-logo-icon">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M2 5h14M2 9h9M2 13h6" stroke="#080b0f" strokeWidth="2.2" strokeLinecap="round"/>
                <circle cx="14" cy="9" r="2.5" fill="#080b0f"/>
              </svg>
            </div>
            OpsPilot
          </div>
          <ul className="lp-nav-links">
            <li><a href="#lp-features">Features</a></li>
            <li><a href="#lp-architecture">Architecture</a></li>
            <li><a href="#lp-stack">Stack</a></li>
          </ul>
          <div className="lp-nav-cta">
            <a href="https://github.com/Abhinav-Marlingaplar/Ops-Pilot" target="_blank" rel="noreferrer">
              <button className="lp-btn lp-btn-ghost">GitHub ↗</button>
            </a>
            <a href="/#/login">
              <button className="lp-btn lp-btn-primary">Get Started →</button>
            </a>
          </div>
        </nav>

        {/* ── Hero ── */}
        <section className="lp-hero">
          <div className="lp-hero-glow" />
          <div className="lp-hero-badge">v1.0.0 · Cloud-Native CI/CD · Kubernetes-native</div>
          <h1 className="lp-hero-h1 lp-fade-up lp-d1">
            Cloud-Native<br/>
            <span className="lp-accent">CI/CD Automation</span><br/>
            Platform
          </h1>
          <p className="lp-hero-sub lp-fade-up lp-d2">
            Automate builds, deployments, scaling, and infrastructure workflows
            with Kubernetes-native CI/CD orchestration.
          </p>
          <div className="lp-hero-actions lp-fade-up lp-d3">
            <a href="/#/login">
              <button className="lp-btn-hero lp-btn-hero-primary">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
                </svg>
                Get Started with GitHub
              </button>
            </a>
            <a href="https://github.com/Abhinav-Marlingaplar/Ops-Pilot" target="_blank" rel="noreferrer">
              <button className="lp-btn-hero lp-btn-hero-ghost">View on GitHub ↗</button>
            </a>
          </div>
          <div className="lp-pipeline-viz lp-fade-up lp-d4">
            <PipelineVisualizer />
          </div>
        </section>

        <div className="lp-divider" />

        {/* ── Features ── */}
        <section className="lp-features" id="lp-features">
          <div className="lp-section-inner">
            <div className="lp-section-tag lp-reveal">Platform Capabilities</div>
            <h2 className="lp-section-title lp-reveal">Everything you need.<br/>Nothing you don't.</h2>
            <p className="lp-section-sub lp-reveal">Built from first principles. Every component designed for production reliability, not demo convenience.</p>
            <div className="lp-features-grid lp-reveal">
              {[
                { icon: '⚡', title: 'Webhook-Triggered Builds',     desc: 'POST to /webhook and watch your pipeline spin up instantly. JWT-authenticated, RabbitMQ-backed job queue survives backend restarts.' },
                { icon: '📡', title: 'Real-Time Log Streaming',       desc: 'Every stdout/stderr line streams to your browser via Socket.IO as it happens. No polling. No delays. True live logs.' },
                { icon: '☸',  title: 'Kubernetes Autoscaling',        desc: 'HPA scales worker pods 1→5 automatically based on CPU (60%) and memory (75%). Queue spike? New workers spin up within seconds.' },
                { icon: '🔒', title: 'Production Security',           desc: 'Non-root containers, read-only root filesystem, JWT auth on every endpoint, Kubernetes Secrets management with Vault upgrade path.' },
                { icon: '🐳', title: 'Docker Image Builder',          desc: 'Detects Dockerfile in the repo root and builds a tagged image automatically as the final pipeline step. No extra configuration.' },
                { icon: '📊', title: 'Pipeline Stage Visualization',  desc: 'GitHub Actions–style stage tracker. Watch Clone → Install → Test → Docker → Complete animate in real time.' },
              ].map(f => (
                <div key={f.title} className="lp-feature-card">
                  <div className="lp-feature-icon">{f.icon}</div>
                  <div className="lp-feature-title">{f.title}</div>
                  <div className="lp-feature-desc">{f.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="lp-divider" />

        {/* ── Architecture ── */}
        <section id="lp-architecture" style={{ position: 'relative', zIndex: 1, padding: '100px 48px' }}>
          <div className="lp-section-inner">
            <div className="lp-section-tag lp-reveal">How it works</div>
            <h2 className="lp-section-title lp-reveal">Five components.<br/>One pipeline.</h2>
            <p className="lp-section-sub lp-reveal">A clean separation of concerns — each component does exactly one thing and does it well.</p>
            <div className="lp-arch-flow lp-reveal">
              {[
                { num: '01 / TRIGGER',  title: 'Webhook',    desc: 'POST /webhook with repo, branch, commit. JWT-authenticated. Build row inserted into Postgres instantly.' },
                { num: '02 / QUEUE',    title: 'RabbitMQ',   desc: 'Durable build_jobs queue decouples job intake from execution. Jobs survive broker restarts.' },
                { num: '03 / EXECUTE',  title: 'Worker',     desc: 'Clones repo, runs npm install + npm test, builds Docker image. Streams every log line live.' },
                { num: '04 / STORE',    title: 'PostgreSQL', desc: 'ACID-compliant build records, full log storage, status history. All queryable.' },
                { num: '05 / OBSERVE',  title: 'Dashboard',  desc: 'React + Socket.IO. Live build list, stage tracker, streaming terminal. No refresh needed.' },
              ].map((step, i, arr) => (
                <div key={step.num} className="lp-arch-step">
                  <div className="lp-arch-step-num">{step.num}</div>
                  <div className="lp-arch-step-title">{step.title}</div>
                  <div className="lp-arch-step-desc">{step.desc}</div>
                  {i < arr.length - 1 && <div className="lp-arch-arrow">→</div>}
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="lp-divider" />

        {/* ── Stats ── */}
        <section className="lp-stats">
          <div className="lp-section-inner">
            <div className="lp-section-tag lp-reveal">By the numbers</div>
            <h2 className="lp-section-title lp-reveal">Built for scale.</h2>
            <div className="lp-stats-grid lp-reveal">
              <StatCard target={5}  label="Max worker pods (HPA)" />
              <StatCard target={11} label="Kubernetes manifests" />
              <StatCard target={null} prefix="~50ms" label="Webhook → queue latency" />
              <StatCard target={3}  label="Retry attempts on failure" />
            </div>
          </div>
        </section>

        <div className="lp-divider" />

        {/* ── Tech Stack ── */}
        <section id="lp-stack" style={{ position: 'relative', zIndex: 1, padding: '100px 48px' }}>
          <div className="lp-section-inner">
            <div className="lp-section-tag lp-reveal">Technology</div>
            <h2 className="lp-section-title lp-reveal">Production-grade<br/>all the way down.</h2>
            <p className="lp-section-sub lp-reveal">Every technology chosen for a specific reason. No cargo-culting.</p>
            <div className="lp-tech-grid lp-reveal">
              {TECH.map(t => (
                <div key={t.label} className="lp-tech-pill">
                  <span className="lp-tech-dot" style={{ background: t.color }} />
                  {t.label}
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="lp-divider" />

        {/* ── CTA ── */}
        <section className="lp-cta-section">
          <div className="lp-cta-box lp-reveal">
            <h2>Ready to ship faster?</h2>
            <p>Connect your GitHub account and trigger your first automated build in under 5 minutes.</p>
            <div
              className="lp-cta-cmd"
              onClick={() => navigator.clipboard?.writeText('git clone https://github.com/Abhinav-Marlingaplar/Ops-Pilot')}
            >
              <span style={{ color: 'rgba(255,255,255,0.3)' }}>$</span>
              &nbsp;https://github.com/Abhinav-Marlingaplar/Ops-Pilot
              <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>click to copy</span>
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <a href="/#/login">
                <button className="lp-btn-hero lp-btn-hero-primary">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
                  </svg>
                  Get Started with GitHub →
                </button>
              </a>
              <a href="https://github.com/Abhinav-Marlingaplar/Ops-Pilot" target="_blank" rel="noreferrer">
                <button className="lp-btn-hero lp-btn-hero-ghost">Read the Docs ↗</button>
              </a>
            </div>
          </div>
        </section>

        {/* ── Footer ── */}
        <footer className="lp-footer">
          <div className="lp-footer-left">© 2026 OpsPilot · Built by Abhinav · Final Year CSE Project</div>
          <ul className="lp-footer-links">
            <li><a href="https://github.com/Abhinav-Marlingaplar/Ops-Pilot" target="_blank" rel="noreferrer">GitHub ↗</a></li>
            <li><a href="#lp-features">Features</a></li>
            <li><a href="#lp-architecture">Architecture</a></li>
            <li><a href="/#/login">Dashboard</a></li>
          </ul>
        </footer>

      </div>
    </>
  );
}

// ─── All CSS scoped with lp- prefix so it never bleeds into the dashboard ─────

const LANDING_CSS = `
  /* ── Tokens ── */
  .lp-root {
    --lp-bg:          #080b0f;
    --lp-bg-2:        #0d1117;
    --lp-bg-3:        #111820;
    --lp-surface:     rgba(255,255,255,0.04);
    --lp-surface-2:   rgba(255,255,255,0.07);
    --lp-border:      rgba(255,255,255,0.08);
    --lp-border-2:    rgba(0,255,136,0.2);
    --lp-green:       #00ff88;
    --lp-green-dim:   #00cc6a;
    --lp-green-glow:  rgba(0,255,136,0.15);
    --lp-green-glow2: rgba(0,255,136,0.06);
    --lp-blue:        #4f9eff;
    --lp-red:         #ff5f5f;
    --lp-yellow:      #ffcc44;
    --lp-text:        #e8edf2;
    --lp-text-2:      #8b949e;
    --lp-text-3:      #4d5966;
    --lp-font-mono:   'JetBrains Mono', monospace;
    --lp-font-body:   'Inter', sans-serif;
    --lp-ease:        cubic-bezier(0.16, 1, 0.3, 1);
  }

  /* ── Base ── */
  .lp-root {
    font-family: var(--lp-font-body);
    background: var(--lp-bg);
    color: var(--lp-text);
    overflow-x: clip;
    -webkit-font-smoothing: antialiased;
    position: relative;
  }
  .lp-root a { color: inherit; text-decoration: none; }

  /* Noise overlay */
  .lp-root::before {
    content: '';
    position: fixed;
    inset: 0;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E");
    pointer-events: none;
    z-index: 0;
  }

  /* ── Keyframes ── */
  @keyframes lp-fadeUp    { from { opacity:0; transform:translateY(24px); } to { opacity:1; transform:translateY(0); } }
  @keyframes lp-glow      { 0%,100%{opacity:.5} 50%{opacity:1} }
  @keyframes lp-pulse-ring{ 0%{transform:scale(1);opacity:.6} 100%{transform:scale(2.2);opacity:0} }
  @keyframes lp-nodeAct   { 0%{transform:scale(.7);opacity:0} 60%{transform:scale(1.15)} 100%{transform:scale(1);opacity:1} }
  @keyframes lp-connShim  { from{transform:translateX(-100%)} to{transform:translateX(200%)} }
  @keyframes lp-termBlink { 0%,100%{opacity:1} 50%{opacity:0} }
  @keyframes lp-borderGlow{ 0%,100%{border-color:rgba(0,255,136,.15);box-shadow:0 0 0 rgba(0,255,136,0)} 50%{border-color:rgba(0,255,136,.4);box-shadow:0 0 20px rgba(0,255,136,.08)} }
  @keyframes lp-logIn     { from{opacity:0;transform:translateX(-6px)} to{opacity:1;transform:translateX(0)} }

  /* ── Scroll reveal ── */
  .lp-reveal { opacity:0; transform:translateY(24px); transition:opacity .7s var(--lp-ease), transform .7s var(--lp-ease); }
  .lp-reveal.lp-visible { opacity:1; transform:translateY(0); }

  /* ── Hero animations ── */
  .lp-fade-up { animation: lp-fadeUp 0.7s var(--lp-ease) both; }
  .lp-d1 { animation-delay:.1s }
  .lp-d2 { animation-delay:.2s }
  .lp-d3 { animation-delay:.3s }
  .lp-d4 { animation-delay:.5s }

  /* ── Nav ── */
  .lp-nav {
    position: fixed; top:0; left:0; right:0; z-index:100;
    display:flex; align-items:center; justify-content:space-between;
    padding:0 48px; height:64px;
    background:rgba(8,11,15,0.85);
    backdrop-filter:blur(20px);
    border-bottom:1px solid var(--lp-border);
  }
  .lp-nav-logo {
    display:flex; align-items:center; gap:10px;
    font-family:var(--lp-font-mono); font-weight:700; font-size:16px;
  }
  .lp-nav-logo-icon {
    width:32px; height:32px; background:var(--lp-green);
    border-radius:8px; display:flex; align-items:center; justify-content:center;
  }
  .lp-nav-links { display:flex; align-items:center; gap:32px; list-style:none; }
  .lp-nav-links a { font-size:13px; color:var(--lp-text-2); transition:color .2s; font-family:var(--lp-font-mono); }
  .lp-nav-links a:hover { color:var(--lp-text); }
  .lp-nav-cta { display:flex; align-items:center; gap:12px; }

  .lp-btn { font-family:var(--lp-font-mono); font-size:13px; font-weight:500; padding:8px 20px; border-radius:6px; cursor:pointer; transition:all .2s; border:none; }
  .lp-btn-ghost { background:transparent; color:var(--lp-text-2); border:1px solid var(--lp-border); }
  .lp-btn-ghost:hover { border-color:rgba(255,255,255,.2); color:var(--lp-text); }
  .lp-btn-primary { background:var(--lp-green); color:#080b0f; font-weight:700; }
  .lp-btn-primary:hover { background:#00e87a; transform:translateY(-1px); box-shadow:0 8px 24px rgba(0,255,136,.25); }

  /* ── Hero ── */
  .lp-hero {
    position:relative; min-height:100vh;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    padding:120px 48px 80px; text-align:center; overflow:hidden;
  }
  .lp-hero::after {
    content:''; position:absolute; inset:0;
    background-image: linear-gradient(rgba(0,255,136,.03) 1px,transparent 1px), linear-gradient(90deg,rgba(0,255,136,.03) 1px,transparent 1px);
    background-size:60px 60px;
    mask-image:radial-gradient(ellipse 80% 80% at 50% 50%,black 20%,transparent 100%);
    pointer-events:none;
  }
  .lp-hero-glow {
    position:absolute; top:20%; left:50%; transform:translateX(-50%);
    width:600px; height:600px;
    background:radial-gradient(ellipse,rgba(0,255,136,.08) 0%,transparent 70%);
    pointer-events:none;
  }
  .lp-hero-badge {
    display:inline-flex; align-items:center; gap:8px;
    padding:6px 14px; border:1px solid var(--lp-border-2); border-radius:99px;
    font-family:var(--lp-font-mono); font-size:11px; color:var(--lp-green);
    background:var(--lp-green-glow2); margin-bottom:28px;
    animation:lp-fadeUp .6s var(--lp-ease) both;
  }
  .lp-hero-badge::before {
    content:''; width:6px; height:6px; border-radius:50%;
    background:var(--lp-green); animation:lp-glow 2s ease-in-out infinite;
  }
  .lp-hero-h1 {
    font-family:var(--lp-font-mono); font-size:clamp(36px,5vw,68px);
    font-weight:800; line-height:1.05; letter-spacing:-.03em;
    color:var(--lp-text); margin-bottom:24px; max-width:900px;
  }
  .lp-accent { color:var(--lp-green); }
  .lp-hero-sub { font-size:clamp(15px,2vw,18px); color:var(--lp-text-2); max-width:560px; line-height:1.7; margin-bottom:40px; font-weight:300; }
  .lp-hero-actions { display:flex; align-items:center; gap:16px; margin-bottom:72px; flex-wrap:wrap; justify-content:center; }

  .lp-btn-hero { font-family:var(--lp-font-mono); font-size:14px; font-weight:700; padding:14px 32px; border-radius:8px; cursor:pointer; transition:all .25s; border:none; display:flex; align-items:center; gap:8px; }
  .lp-btn-hero-primary { background:var(--lp-green); color:#080b0f; }
  .lp-btn-hero-primary:hover { background:#00e87a; transform:translateY(-2px); box-shadow:0 16px 40px rgba(0,255,136,.3); }
  .lp-btn-hero-ghost { background:var(--lp-surface); color:var(--lp-text); border:1px solid var(--lp-border); }
  .lp-btn-hero-ghost:hover { background:var(--lp-surface-2); border-color:rgba(255,255,255,.15); }

  /* ── Pipeline viz ── */
  .lp-pipeline-viz { width:100%; max-width:800px; margin:0 auto; animation:lp-fadeUp .8s var(--lp-ease) .6s both; position:relative; z-index:1; }
  .lp-pipeline-container {
    background:rgba(13,17,23,.9); border:1px solid var(--lp-border); border-radius:16px; overflow:hidden;
    box-shadow:0 32px 80px rgba(0,0,0,.5),0 0 0 1px rgba(0,255,136,.05);
  }
  .lp-pipeline-titlebar { display:flex; align-items:center; gap:8px; padding:14px 20px; border-bottom:1px solid var(--lp-border); background:rgba(255,255,255,.02); }
  .lp-tl-dot { width:12px; height:12px; border-radius:50%; }
  .lp-tl-red    { background:#ff5f57; }
  .lp-tl-yellow { background:#ffbd2e; }
  .lp-tl-green  { background:#28c840; }
  .lp-tl-title  { font-family:var(--lp-font-mono); font-size:11px; color:rgba(255,255,255,.3); margin-left:8px; letter-spacing:.05em; }
  .lp-tl-status { margin-left:auto; font-family:var(--lp-font-mono); font-size:11px; display:flex; align-items:center; gap:6px; }
  .lp-tl-status::before { content:''; width:6px; height:6px; border-radius:50%; background:currentColor; animation:lp-glow 1.5s ease-in-out infinite; }

  .lp-pipeline-stages-viz { display:flex; align-items:center; padding:36px 40px; gap:0; overflow-x:auto; }
  .lp-viz-stage { display:flex; flex-direction:column; align-items:center; gap:10px; flex:1; position:relative; }
  .lp-viz-node {
    position:relative; width:44px; height:44px; border-radius:50%;
    display:flex; align-items:center; justify-content:center;
    font-size:16px; transition:all .4s; z-index:2;
  }
  .lp-viz-node--waiting { background:rgba(255,255,255,.04); border:2px solid rgba(255,255,255,.1); color:rgba(255,255,255,.2); }
  .lp-viz-node--running { background:rgba(79,158,255,.15); border:2px solid var(--lp-blue); color:var(--lp-blue); animation:lp-nodeAct .4s var(--lp-ease) both; }
  .lp-viz-node--running::after { content:''; position:absolute; inset:-4px; border-radius:50%; border:2px solid var(--lp-blue); animation:lp-pulse-ring 1.2s ease-out infinite; }
  .lp-viz-node--success { background:rgba(0,255,136,.12); border:2px solid var(--lp-green); color:var(--lp-green); animation:lp-nodeAct .4s var(--lp-ease) both; box-shadow:0 0 20px rgba(0,255,136,.2); }
  .lp-viz-label { font-family:var(--lp-font-mono); font-size:10px; color:var(--lp-text-3); text-align:center; letter-spacing:.04em; transition:color .3s; }
  .lp-viz-stage.lp-active .lp-viz-label { color:var(--lp-blue); }
  .lp-viz-stage.lp-done   .lp-viz-label { color:var(--lp-green); }
  .lp-viz-duration { font-family:var(--lp-font-mono); font-size:9px; color:var(--lp-text-3); height:12px; }
  .lp-viz-stage.lp-done .lp-viz-duration { color:rgba(0,255,136,.6); }
  .lp-viz-connector { flex:1; height:2px; background:rgba(255,255,255,.06); margin-bottom:34px; position:relative; overflow:hidden; transition:background .4s; }
  .lp-viz-connector.lp-active { background:rgba(79,158,255,.3); }
  .lp-viz-connector.lp-done   { background:rgba(0,255,136,.3); }
  .lp-viz-connector.lp-active::after { content:''; position:absolute; inset:0; background:linear-gradient(90deg,transparent,var(--lp-blue),transparent); animation:lp-connShim 1.2s linear infinite; }

  .lp-pipeline-log { border-top:1px solid var(--lp-border); padding:16px 20px; font-family:var(--lp-font-mono); font-size:12px; background:rgba(0,0,0,.3); min-height:100px; max-height:100px; overflow:hidden; }
  .lp-log-line { display:flex; gap:12px; line-height:1.8; opacity:0; transform:translateX(-6px); transition:all .3s; }
  .lp-log-line--visible { opacity:1; transform:translateX(0); animation:lp-logIn .3s var(--lp-ease) both; }
  .lp-log-num { color:rgba(255,255,255,.15); min-width:24px; text-align:right; }
  .lp-log-text { color:rgba(255,255,255,.5); }
  .lp-log-text--cmd     { color:var(--lp-yellow); }
  .lp-log-text--success { color:var(--lp-green); }
  .lp-log-text--info    { color:var(--lp-blue); }

  /* ── Sections ── */
  .lp-section-inner { max-width:1100px; margin:0 auto; }
  .lp-section-tag { font-family:var(--lp-font-mono); font-size:11px; color:var(--lp-green); letter-spacing:.12em; text-transform:uppercase; margin-bottom:14px; display:flex; align-items:center; gap:8px; }
  .lp-section-tag::before { content:''; width:20px; height:1px; background:var(--lp-green); }
  .lp-section-title { font-family:var(--lp-font-mono); font-size:clamp(28px,3.5vw,44px); font-weight:700; line-height:1.15; letter-spacing:-.02em; color:var(--lp-text); margin-bottom:16px; }
  .lp-section-sub { font-size:16px; color:var(--lp-text-2); max-width:520px; line-height:1.7; font-weight:300; }
  .lp-divider { height:1px; background:linear-gradient(90deg,transparent,var(--lp-border),transparent); margin:0 48px; }

  /* ── Features ── */
  .lp-features { background:var(--lp-bg-2); position:relative; z-index:1; padding:100px 48px; }
  .lp-features-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:1px; background:var(--lp-border); border:1px solid var(--lp-border); border-radius:16px; overflow:hidden; margin-top:60px; }
  .lp-feature-card { background:var(--lp-bg-2); padding:36px 32px; transition:background .3s; position:relative; overflow:hidden; }
  .lp-feature-card::before { content:''; position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg,transparent,rgba(0,255,136,0),transparent); transition:background .3s; }
  .lp-feature-card:hover { background:var(--lp-bg-3); }
  .lp-feature-card:hover::before { background:linear-gradient(90deg,transparent,rgba(0,255,136,.4),transparent); }
  .lp-feature-icon { width:44px; height:44px; border-radius:10px; background:var(--lp-green-glow2); border:1px solid var(--lp-border-2); display:flex; align-items:center; justify-content:center; font-size:20px; margin-bottom:20px; }
  .lp-feature-title { font-family:var(--lp-font-mono); font-size:15px; font-weight:600; color:var(--lp-text); margin-bottom:10px; }
  .lp-feature-desc { font-size:14px; color:var(--lp-text-2); line-height:1.7; font-weight:300; }

  /* ── Architecture ── */
  .lp-arch-flow { display:flex; align-items:stretch; gap:0; margin-top:60px; border:1px solid var(--lp-border); border-radius:16px; overflow:hidden; }
  .lp-arch-step { flex:1; padding:32px 24px; background:var(--lp-bg-2); border-right:1px solid var(--lp-border); position:relative; transition:background .3s; }
  .lp-arch-step:last-child { border-right:none; }
  .lp-arch-step:hover { background:var(--lp-bg-3); }
  .lp-arch-step-num   { font-family:var(--lp-font-mono); font-size:11px; color:var(--lp-green); margin-bottom:12px; letter-spacing:.08em; }
  .lp-arch-step-title { font-family:var(--lp-font-mono); font-size:14px; font-weight:600; color:var(--lp-text); margin-bottom:8px; }
  .lp-arch-step-desc  { font-size:13px; color:var(--lp-text-2); line-height:1.6; }
  .lp-arch-arrow { position:absolute; right:-13px; top:50%; transform:translateY(-50%); width:24px; height:24px; background:var(--lp-bg-3); border:1px solid var(--lp-border); border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:11px; color:var(--lp-green); z-index:2; }

  /* ── Stats ── */
  .lp-stats { background:var(--lp-bg-2); position:relative; z-index:1; padding:100px 48px; }
  .lp-stats-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:1px; background:var(--lp-border); border:1px solid var(--lp-border); border-radius:16px; overflow:hidden; margin-top:60px; }
  .lp-stat-card { background:var(--lp-bg-2); padding:40px 32px; text-align:center; transition:background .3s; }
  .lp-stat-card:hover { background:var(--lp-bg-3); }
  .lp-stat-number { font-family:var(--lp-font-mono); font-size:48px; font-weight:800; color:var(--lp-green); letter-spacing:-.04em; line-height:1; margin-bottom:8px; }
  .lp-stat-label  { font-size:13px; color:var(--lp-text-2); }

  /* ── Tech ── */
  .lp-tech-grid { display:flex; flex-wrap:wrap; gap:12px; margin-top:48px; }
  .lp-tech-pill { display:flex; align-items:center; gap:8px; padding:10px 18px; background:var(--lp-surface); border:1px solid var(--lp-border); border-radius:99px; font-family:var(--lp-font-mono); font-size:13px; color:var(--lp-text-2); transition:all .2s; cursor:default; }
  .lp-tech-pill:hover { background:var(--lp-surface-2); border-color:rgba(0,255,136,.2); color:var(--lp-text); }
  .lp-tech-dot { width:6px; height:6px; border-radius:50%; flex-shrink:0; }

  /* ── CTA ── */
  .lp-cta-section { text-align:center; padding:120px 48px; position:relative; z-index:1; }
  .lp-cta-box { max-width:640px; margin:0 auto; padding:64px 48px; background:var(--lp-bg-2); border:1px solid var(--lp-border-2); border-radius:24px; position:relative; overflow:hidden; animation:lp-borderGlow 4s ease-in-out infinite; }
  .lp-cta-box::before { content:''; position:absolute; top:-50%; left:50%; transform:translateX(-50%); width:300px; height:300px; background:radial-gradient(ellipse,rgba(0,255,136,.06) 0%,transparent 70%); pointer-events:none; }
  .lp-cta-box h2 { font-family:var(--lp-font-mono); font-size:32px; font-weight:700; color:var(--lp-text); margin-bottom:16px; letter-spacing:-.02em; }
  .lp-cta-box p  { font-size:15px; color:var(--lp-text-2); line-height:1.7; margin-bottom:36px; }
  .lp-cta-cmd { display:flex; align-items:center; gap:12px; background:rgba(0,0,0,.4); border:1px solid var(--lp-border); border-radius:8px; padding:14px 20px; margin-bottom:28px; font-family:var(--lp-font-mono); font-size:13px; color:var(--lp-green); cursor:pointer; transition:border-color .2s; }
  .lp-cta-cmd:hover { border-color:rgba(0,255,136,.3); }

  /* ── Footer ── */
  .lp-footer { border-top:1px solid var(--lp-border); padding:40px 48px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px; position:relative; z-index:1; }
  .lp-footer-left { font-family:var(--lp-font-mono); font-size:13px; color:var(--lp-text-3); }
  .lp-footer-links { display:flex; gap:24px; list-style:none; }
  .lp-footer-links a { font-family:var(--lp-font-mono); font-size:12px; color:var(--lp-text-3); transition:color .2s; }
  .lp-footer-links a:hover { color:var(--lp-green); }
`;