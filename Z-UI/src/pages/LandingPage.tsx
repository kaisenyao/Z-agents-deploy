import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import logo from '../logo.png';
import '../styles/landing.css';

// ── Typed animation ──────────────────────────────────────────────────────────

const TYPED_STRINGS = [
  'Investment Research',
  'Quantitative Strategy',
  'Risk Management',
  'Committee Decisions',
  'Financial Intelligence',
];

function useTypedAnimation() {
  const [display, setDisplay] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [index, setIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);

  useEffect(() => {
    const current = TYPED_STRINGS[index];
    const typeSpeed = isDeleting ? 30 : 55;

    const timer = setTimeout(() => {
      if (!isDeleting) {
        setDisplay(current.slice(0, charIndex + 1));
        if (charIndex + 1 === current.length) {
          // Pause before deleting
          setTimeout(() => setIsDeleting(true), 1800);
        } else {
          setCharIndex((c) => c + 1);
        }
      } else {
        setDisplay(current.slice(0, charIndex - 1));
        if (charIndex - 1 === 0) {
          setIsDeleting(false);
          setIndex((i) => (i + 1) % TYPED_STRINGS.length);
          setCharIndex(0);
        } else {
          setCharIndex((c) => c - 1);
        }
      }
    }, typeSpeed);

    return () => clearTimeout(timer);
  }, [charIndex, isDeleting, index]);

  return display;
}

// ── Scroll observer for fade-in ───────────────────────────────────────────────

function useFadeIn(containerRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const targets = container.querySelectorAll('.lp-fade-in');

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
    );

    targets.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [containerRef]);
}

// ── Contact SVG ───────────────────────────────────────────────────────────────

function ContactIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 6h16v12H4z" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

function WorkflowIcon({ path }: { path: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

// ── LandingPage ───────────────────────────────────────────────────────────────

export function LandingPage() {
  const typedText = useTypedAnimation();
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState('home');
  const pageRef = useRef<HTMLDivElement>(null);

  useFadeIn(pageRef);

  // Navbar scroll effect
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const sectionIds = ['home', 'highlights', 'workflow', 'multi-agents'] as const;
    const sections = sectionIds
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => section !== null);

    if (!sections.length) return;

    const updateFromHash = () => {
      const hashSection = window.location.hash.replace('#', '');
      if (sectionIds.includes(hashSection as (typeof sectionIds)[number])) {
        setActiveSection(hashSection);
      }
    };

    updateFromHash();

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

        if (visibleEntries.length > 0) {
          setActiveSection(visibleEntries[0].target.id);
        }
      },
      {
        rootMargin: '-35% 0px -45% 0px',
        threshold: [0.2, 0.35, 0.5, 0.65],
      },
    );

    sections.forEach((section) => observer.observe(section));
    window.addEventListener('hashchange', updateFromHash);

    return () => {
      observer.disconnect();
      window.removeEventListener('hashchange', updateFromHash);
    };
  }, []);

  const navItems = [
    { id: 'home', label: 'Home' },
    { id: 'highlights', label: 'Highlights' },
    { id: 'workflow', label: 'Workflow' },
    { id: 'multi-agents', label: 'Multi-Agents' },
  ] as const;

  return (
    <div className="landing-page" ref={pageRef}>
      {/* Animated background */}
      <div className="lp-gradient-bg" aria-hidden="true">
        <div className="lp-gradient-orb lp-orb-1" />
        <div className="lp-gradient-orb lp-orb-2" />
        <div className="lp-gradient-orb lp-orb-3" />
      </div>

      {/* ── Navigation ── */}
      <nav className={`lp-navbar${scrolled ? ' scrolled' : ''}`}>
        <a href="#home" className="lp-nav-logo" onClick={(e) => { e.preventDefault(); document.getElementById('home')?.scrollIntoView({ behavior: 'smooth' }); }}>
          <img src={logo} alt="ClearPath" />
        </a>
        <ul className="lp-nav-links">
          {navItems.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className={activeSection === item.id ? 'active' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  setActiveSection(item.id);
                  document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="lp-nav-right">
          <a
            href="https://forms.gle/82QM9Wo1BB1osv7z5"
            target="_blank"
            rel="noopener noreferrer"
            className="lp-nav-contact"
            aria-label="Contact Us"
          >
            <span>Contact Us</span>
          </a>
        </div>
      </nav>

      <div className="lp-page-content">

        {/* ── Hero ── */}
        <section className="lp-hero" id="home">
          <div className="lp-hero-inner">
            <div className="lp-hero-badge">
              <span className="lp-hero-badge-dot" />
              SUPERVISOR-ORCHESTRATED MULTI-AGENT SYSTEM
            </div>
            <h1 className="lp-hero-title">
              <span className="lp-gradient-text">ClearPath</span>
              <br />
              AI Investment Workspace
            </h1>
            <div className="lp-hero-typed-container">
              <span className="lp-typed-prefix">Powered by AI for </span>
              <span className="lp-typed-text">{typedText}</span>
              <span className="lp-typed-cursor">|</span>
            </div>
            <p className="lp-hero-description">
              Built on a multi-agent system, ClearPath transforms research into structured portfolio decisions.
              Agents collaborate through iterative reasoning to evaluate strategies and continuously refine 
              outcomes with transparent, evidence-backed insights.
            </p>
            <div className="lp-hero-actions">
              <Link to="/dashboard" className="lp-btn-primary">
                ClearPath Demo
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        </section>

        <div className="lp-section-divider" />

        {/* ── Highlights ── */}
        <section id="highlights">
          <div className="lp-section-inner">
            <div className="lp-section-label">Highlights</div>
            <div className="lp-about-grid lp-fade-in">
              <div>
                <h2 className="lp-section-title">Why ClearPath Is Different</h2>
                <p className="lp-section-subtitle">
                 ClearPath is a supervisor-orchestrated multi-agent system,
                 where research, quant, and risk agents operate as independent
                 reasoning modules instead of a monolithic model.
                </p>
                <p style={{ marginTop: '1rem', fontSize: '0.95rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                  To mitigate failure modes in single-agent systems (e.g., sycophancy), we implement a {' '}
                  <strong style={{ color: 'var(--text-primary)' }}>Disagree and Commit (DoC)</strong> protocol — a
                  structured dissent mechanism that prevents agents from blindly following each other (sycophancy),
                  mirroring the checks and balances of a real investment committee.
                </p>
                <div className="lp-doc-badge">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Submitted to AAAI 2026: AI for Finance
                </div>
              </div>
              <div className="lp-about-stats">
                <div className="lp-stat-card">
                  <div className="lp-stat-value">71.6%</div>
                  <div className="lp-stat-label">Overall Accuracy with DoC Protocol</div>
                </div>
                <div className="lp-stat-card">
                  <div className="lp-stat-value">+16.6%</div>
                  <div className="lp-stat-label">Improvement in Risk Management Tasks</div>
                </div>
                <div className="lp-stat-card">
                  <div className="lp-stat-value">89.7%</div>
                  <div className="lp-stat-label">Precision on Quantitative Finance Tasks</div>
                </div>
                <div className="lp-stat-card">
                  <div className="lp-stat-value">3</div>
                  <div className="lp-stat-label">Specialized AI Agents Working in Committee</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="lp-section-divider" />

        {/* ── Workflow ── */}
        <section id="workflow">
          <div className="lp-section-inner">
            <div className="lp-workflow-header lp-fade-in">
              <div className="lp-section-label">WORKFLOW</div>
              <h2 className="lp-section-title">From Idea to Decision</h2>
              <p className="lp-section-subtitle">
                ClearPath connects a research system with a trading simulator, forming a 
                continuous feedback loop between analysis and execution, where structured 
                research drives decisions and real outcomes continuously refine the system.
              </p>
            </div>

            <div className="lp-wf-architecture lp-fade-in">
              {/* Left: Trading Simulator */}
              <div className="lp-wf-module">
                <div className="lp-wf-module-label">Trading Simulator</div>
                <div className="lp-wf-cards lp-wf-cards--col">
                  <div className="lp-wf-card">
                    <div className="lp-workflow-icon">
                      <WorkflowIcon path="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />
                    </div>
                    <div className="lp-wf-card-title">Dashboard</div>
                    <p className="lp-wf-card-desc">Track real-time portfolio performance and decision outcomes across time.</p>
                  </div>
                  <div className="lp-wf-card">
                    <div className="lp-workflow-icon">
                      <WorkflowIcon path="M22 7l-8.5 8.5-5-5L2 17" />
                    </div>
                    <div className="lp-wf-card-title">Trade</div>
                    <p className="lp-wf-card-desc">Execute decisions and observe how strategies perform under live market conditions.</p>
                  </div>
                </div>
              </div>

              {/* Center: Execution Feedback Loop */}
              <div className="lp-wf-bridge" aria-hidden="true">
                <div className="lp-wf-bridge-row lp-wf-bridge-row--top">
                  <span className="lp-wf-bridge-line" />
                  <span className="lp-wf-bridge-arrowhead">→</span>
                </div>
                <div className="lp-wf-bridge-pill">
                  Execution<br />Feedback Loop
                </div>
                <div className="lp-wf-bridge-row lp-wf-bridge-row--bottom">
                  <span className="lp-wf-bridge-arrowhead">←</span>
                  <span className="lp-wf-bridge-line" />
                </div>
              </div>

              {/* Right: Research System */}
              <div className="lp-wf-module lp-wf-module--research">
                <div className="lp-wf-module-label">Research System</div>
                <div className="lp-wf-cards lp-wf-cards--grid">
                  <div className="lp-wf-card">
                    <div className="lp-workflow-icon">
                      <WorkflowIcon path="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35" />
                    </div>
                    <div className="lp-wf-card-title">Search</div>
                    <p className="lp-wf-card-desc">Retrieve structured market intelligence across filings, signals, and macro context.</p>
                  </div>
                  <div className="lp-wf-card">
                    <div className="lp-workflow-icon">
                      <WorkflowIcon path="M18 20V10M12 20V4M6 20v-6" />
                    </div>
                    <div className="lp-wf-card-title">Portfolio</div>
                    <p className="lp-wf-card-desc">Design portfolio strategies with explicit allocations, constraints, and risk exposure.</p>
                  </div>
                  <div className="lp-wf-card">
                    <div className="lp-workflow-icon">
                      <WorkflowIcon path="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 3v5h5M9 12h6M9 16h4" />
                    </div>
                    <div className="lp-wf-card-title">Report</div>
                    <p className="lp-wf-card-desc">Generate structured investment reports with rationale, risk analysis, and positioning.</p>
                  </div>
                  <div className="lp-wf-card">
                    <div className="lp-workflow-icon">
                      <WorkflowIcon path="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </div>
                    <div className="lp-wf-card-title">Chat</div>
                    <p className="lp-wf-card-desc">Interact with AI financial agents to refine, challenge, and evolve your investment thesis.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="lp-section-divider" />

        {/* ── Three Agents ── */}
        <section id="multi-agents">
          <div className="lp-section-inner">
            <div className="lp-section-label">The Multi-Agent Committee</div>
            <h2 className="lp-section-title">Three Specialized Agents</h2>
            <p className="lp-section-subtitle">
              Each agent is an expert in its domain, equipped with purpose-built tools and independent reasoning
              capabilities.
            </p>
            <div className="lp-agents-grid">

              {/* Research Agent */}
              <div className="lp-agent-card lp-fade-in">
                <div className="lp-agent-icon blue">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                </div>
                <div className="lp-agent-name">Research Agent</div>
                <div className="lp-agent-role">Market Intelligence</div>
                <p className="lp-agent-desc">
                  Gathers real-time market intelligence, retrieves SEC filings with AI summaries, analyzes earnings
                  call transcripts, and monitors macro trends through web search.
                </p>
                <div className="lp-agent-tools">
                  <span className="lp-tool-tag">SEC 10-K/10-Q/8-K</span>
                  <span className="lp-tool-tag">Earnings Calls</span>
                  <span className="lp-tool-tag">Finnhub</span>
                  <span className="lp-tool-tag">Web Search</span>
                  <span className="lp-tool-tag">Polygon</span>
                  <span className="lp-tool-tag">SMA · EMA · RSI · MACD</span>
                </div>
              </div>

              {/* Quant Agent */}
              <div className="lp-agent-card lp-fade-in">
                <div className="lp-agent-icon green">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
                </div>
                <div className="lp-agent-name">Quant Agent</div>
                <div className="lp-agent-role">Quantitative Strategy</div>
                <p className="lp-agent-desc">
                  Runs systematic backtests, computes technical indicators, and performs cross-asset correlation
                  analysis to identify quantitative signals and strategy performance.
                </p>
                <div className="lp-agent-tools">
                  <span className="lp-tool-tag">SMA Cross</span>
                  <span className="lp-tool-tag">RSI MeanRev</span>
                  <span className="lp-tool-tag">Backtesting</span>
                  <span className="lp-tool-tag">Bollinger Bands</span>
                  <span className="lp-tool-tag">Correlation Matrix</span>
                  <span className="lp-tool-tag">Signal Detection</span>
                </div>
              </div>

              {/* Risk Management Agent */}
              <div className="lp-agent-card lp-fade-in">
                <div className="lp-agent-icon yellow">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                </div>
                <div className="lp-agent-name">Risk Management Agent</div>
                <div className="lp-agent-role">Risk Analysis</div>
                <p className="lp-agent-desc">
                  Quantifies portfolio risk through volatility analysis, Value-at-Risk calculations, and stress
                  testing — providing both quantitative metrics and qualitative risk narratives.
                </p>
                <div className="lp-agent-tools">
                  <span className="lp-tool-tag">VaR (99% CI)</span>
                  <span className="lp-tool-tag">Max Drawdown</span>
                  <span className="lp-tool-tag">Stress Testing</span>
                  <span className="lp-tool-tag">Annualized Vol</span>
                  <span className="lp-tool-tag">Scenario Analysis</span>
                  <span className="lp-tool-tag">Risk Narrative</span>
                </div>
              </div>

            </div>
          </div>
        </section>

        <div className="lp-section-divider" />

        {/* ── Architecture ── */}
        <section id="architecture">
          <div className="lp-section-inner">
            <div className="lp-section-label">System Design</div>
            <h2 className="lp-section-title">How ClearPath Works</h2>
            <p className="lp-section-subtitle">
              A supervisor orchestrates three agents through a LangGraph state machine. Each agent reasons
              independently using ReAct loops before the committee deliberates via the DoC protocol.
            </p>

            <div className="lp-arch-container lp-fade-in">

              {/* Row 1: Input → Orchestration */}
              <div className="lp-arch-row">
                <div className="lp-arch-node lp-arch-node--stat">
                  <div className="lp-arch-node-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
                  <div className="lp-arch-node-label">User Query</div>
                  <div className="lp-arch-node-sub">Investment question</div>
                </div>
                <div className="lp-arch-connector"><span className="lp-arch-conn-line" /><span className="lp-arch-conn-arrow">→</span></div>
                <div className="lp-arch-node lp-arch-node--stat">
                  <div className="lp-arch-node-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg></div>
                  <div className="lp-arch-node-label">Supervisor</div>
                  <div className="lp-arch-node-sub">LangGraph orchestrator</div>
                </div>
                <div className="lp-arch-connector"><span className="lp-arch-conn-line" /><span className="lp-arch-conn-arrow">→</span></div>
                <div className="lp-arch-node lp-arch-node--stat">
                  <div className="lp-arch-node-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></div>
                  <div className="lp-arch-node-label">ReAct Loops</div>
                  <div className="lp-arch-node-sub">Reason + Act cycles</div>
                </div>
              </div>

              <div className="lp-arch-row-divider" />

              {/* Row 2: Specialized Agents */}
              <div className="lp-arch-row">
                <div className="lp-arch-node lp-arch-node--research">
                  <div className="lp-arch-node-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg></div>
                  <div className="lp-arch-node-label">Research Agent</div>
                  <div className="lp-arch-node-sub">Market intel</div>
                </div>
                <div className="lp-arch-plus">+</div>
                <div className="lp-arch-node lp-arch-node--quant">
                  <div className="lp-arch-node-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 20V10M12 20V4M6 20v-6"/></svg></div>
                  <div className="lp-arch-node-label">Quant Agent</div>
                  <div className="lp-arch-node-sub">Strategy signals</div>
                </div>
                <div className="lp-arch-plus">+</div>
                <div className="lp-arch-node lp-arch-node--risk">
                  <div className="lp-arch-node-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
                  <div className="lp-arch-node-label">Risk Agent</div>
                  <div className="lp-arch-node-sub">Risk metrics</div>
                </div>
              </div>

              <div className="lp-arch-row-divider" />

              {/* Row 3: DoC → Decision */}
              <div className="lp-arch-row lp-arch-row--center">
                <div className="lp-arch-node lp-arch-node--stat lp-arch-node--wide">
                  <div className="lp-arch-node-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
                  <div className="lp-arch-node-label">Disagree &amp; Commit (DoC)</div>
                  <div className="lp-arch-node-sub">Structured dissent · prevents sycophancy</div>
                </div>
                <div className="lp-arch-connector"><span className="lp-arch-conn-line" /><span className="lp-arch-conn-arrow">→</span></div>
                <div className="lp-arch-node lp-arch-node--stat lp-arch-node--wide">
                  <div className="lp-arch-node-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
                  <div className="lp-arch-node-label">Unified Decision</div>
                  <div className="lp-arch-node-sub">Committee consensus</div>
                </div>
              </div>

              {/* Legend */}
              <div className="lp-arch-legend">
                <div className="lp-arch-legend-item">
                  <div className="lp-arch-legend-dot" style={{ background: '#14c290' }} />
                  LangGraph State Machine
                </div>
                <div className="lp-arch-legend-item">
                  <div className="lp-arch-legend-dot" style={{ background: '#d4af37' }} />
                  Gemini 3 Pro LLM
                </div>
                <div className="lp-arch-legend-item">
                  <div className="lp-arch-legend-dot" style={{ background: '#6495ed' }} />
                  Prompt-first, no fine-tuning
                </div>
              </div>

            </div>
          </div>
        </section>

        <div className="lp-section-divider" />

        {/* ── Results ── */}
        <section id="results">
          <div className="lp-section-inner">
            <div className="lp-section-label">Performance</div>
            <h2 className="lp-section-title">Evaluated Results</h2>
            <p className="lp-section-subtitle">
              Assessed via LangSmith's LLM-as-a-Judge pipeline across 120 hand-annotated data points. ClearPath with
              the DoC protocol significantly outperforms the baseline.
            </p>

            <div className="lp-results-grid">
              <div className="lp-result-card lp-fade-in">
                <div className="lp-result-number">71.6%</div>
                <div className="lp-result-title">Overall Accuracy</div>
                <div className="lp-result-desc">
                  ClearPath with DoC protocol vs. 61.6% baseline — a 10 percentage point improvement in overall
                  decision accuracy.
                </div>
              </div>
              <div className="lp-result-card lp-fade-in">
                <div className="lp-result-number">+16.6%</div>
                <div className="lp-result-title">Risk Task Improvement</div>
                <div className="lp-result-desc">
                  Largest gain observed in risk management tasks, demonstrating the DoC protocol's effectiveness in
                  high-stakes decisions.
                </div>
              </div>
              <div className="lp-result-card lp-fade-in">
                <div className="lp-result-number">89.7%</div>
                <div className="lp-result-title">Quant Precision</div>
                <div className="lp-result-desc">
                  Highest precision achieved on quantitative finance tasks, where structured agent specialization
                  delivers the strongest signal.
                </div>
              </div>
            </div>

            <div className="lp-results-bottom">
              <div className="lp-info-pill"><span>Model:</span> Gemini 2.5 Flash</div>
              <div className="lp-info-pill"><span>Framework:</span> LangGraph</div>
              <div className="lp-info-pill"><span>Evaluation:</span> LangSmith LLM-as-a-Judge</div>
              <div className="lp-info-pill"><span>Dataset:</span> 120 hand-annotated points</div>
            </div>
          </div>
        </section>

        <div className="lp-section-divider" />

        {/* ── Footer ── */}
        <footer className="lp-footer">
          <div className="lp-footer-inner">
            <a href="#home" className="lp-footer-logo">
              <img src={logo} alt="ClearPath" />
            </a>
            <p className="lp-footer-text">ClearPath © 2026</p>
            <div className="lp-footer-links">
              <a
                href="https://forms.gle/82QM9Wo1BB1osv7z5"
                target="_blank"
                rel="noopener noreferrer"
                className="lp-footer-link"
                aria-label="Contact Us"
              >
                <ContactIcon />
              </a>
              <a
                href="https://www.linkedin.com/company/clearpathtech"
                target="_blank"
                rel="noopener noreferrer"
                className="lp-footer-link"
                aria-label="LinkedIn"
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6.94 8.5A1.56 1.56 0 1 1 6.94 5.38a1.56 1.56 0 0 1 0 3.12ZM5.5 9.75h2.88V18H5.5V9.75Zm4.69 0h2.76v1.13h.04c.38-.73 1.32-1.5 2.72-1.5 2.91 0 3.45 1.92 3.45 4.41V18h-2.88v-3.74c0-.89-.02-2.04-1.24-2.04-1.24 0-1.43.97-1.43 1.98V18H10.2V9.75Z" />
                </svg>
              </a>
            </div>
          </div>
        </footer>

      </div>
    </div>
  );
}
