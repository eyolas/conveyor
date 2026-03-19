<script setup lang="ts">
import { ref, onMounted } from 'vue';

const visible = ref(false);
onMounted(() => {
  requestAnimationFrame(() => {
    visible.value = true;
  });
});
</script>

<template>
  <div class="conveyor-home" :class="{ visible }">
    <!-- ─── Hero Section ───────────────────────────── -->
    <section class="hero">
      <div class="hero-grid-bg" aria-hidden="true"></div>
      <div class="hero-glow" aria-hidden="true"></div>

      <div class="hero-content">
        <div class="hero-badge">
          <span class="badge-dot"></span>
          v0.4.0 &mdash; Open Source
        </div>

        <h1 class="hero-title">
          <span class="title-line line-1">Job queues</span>
          <span class="title-line line-2">without <em>Redis</em></span>
        </h1>

        <p class="hero-tagline">
          A multi-backend job queue with a BullMQ-like API. PostgreSQL, SQLite,
          or in-memory — switch stores in one line. First-class TypeScript for
          Deno, Node.js, and Bun.
        </p>

        <div class="hero-actions">
          <a href="/guide/getting-started" class="btn btn-primary">
            <span>Get Started</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 3L11 8L6 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </a>
          <a href="https://github.com/eyolas/conveyor" class="btn btn-ghost" target="_blank">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
            </svg>
            GitHub
          </a>
        </div>
      </div>

      <!-- ─── Conveyor Belt Animation ─── -->
      <div class="conveyor-track" aria-hidden="true">
        <div class="track-line"></div>
        <div class="track-zones">
          <div class="zone zone-waiting">
            <span>WAITING</span>
          </div>
          <div class="zone zone-active">
            <span>ACTIVE</span>
          </div>
          <div class="zone zone-done">
            <span>COMPLETED</span>
          </div>
        </div>
        <div class="jobs-stream">
          <div class="job-box j1"><span>job:1</span></div>
          <div class="job-box j2"><span>job:2</span></div>
          <div class="job-box j3"><span>job:3</span></div>
          <div class="job-box j4"><span>job:4</span></div>
          <div class="job-box j5"><span>job:5</span></div>
          <div class="job-box j6"><span>job:6</span></div>
          <div class="job-box j7"><span>job:7</span></div>
          <div class="job-box j8"><span>job:8</span></div>
        </div>
        <div class="track-teeth">
          <span v-for="n in 40" :key="n" class="tooth"></span>
        </div>
      </div>
    </section>

    <!-- ─── Features Section ───────────────────────── -->
    <section class="features-section">
      <div class="features-container">
        <h2 class="section-label">Capabilities</h2>

        <div class="features-grid">
          <div class="feature-card" v-for="(feat, i) in features" :key="i" :style="{ '--delay': `${i * 80}ms` }">
            <div class="feature-icon" v-html="feat.icon"></div>
            <h3>{{ feat.title }}</h3>
            <p>{{ feat.details }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ─── Code Preview Section ───────────────────── -->
    <section class="code-section">
      <div class="code-container">
        <h2 class="section-label">5 lines to your first queue</h2>
        <div class="code-window">
          <div class="code-chrome">
            <span class="dot red"></span>
            <span class="dot yellow"></span>
            <span class="dot green"></span>
            <span class="code-filename">queue.ts</span>
          </div>
          <pre class="code-body"><code><span class="k">import</span> { <span class="t">Queue</span>, <span class="t">Worker</span> } <span class="k">from</span> <span class="s">'@conveyor/core'</span>;
<span class="k">import</span> { <span class="t">MemoryStore</span> } <span class="k">from</span> <span class="s">'@conveyor/store-memory'</span>;

<span class="k">const</span> <span class="v">store</span> = <span class="k">new</span> <span class="t">MemoryStore</span>();
<span class="k">const</span> <span class="v">queue</span> = <span class="k">new</span> <span class="t">Queue</span>&lt;<span class="t">{ email: string }</span>&gt;(<span class="s">'notifications'</span>, { store });

<span class="c">// Process jobs with full type safety</span>
<span class="k">const</span> <span class="v">worker</span> = <span class="k">new</span> <span class="t">Worker</span>(<span class="s">'notifications'</span>, <span class="k">async</span> (job) =&gt; {
  <span class="k">await</span> sendEmail(job.data.<span class="v">email</span>);
}, { store, <span class="v">concurrency</span>: <span class="n">5</span> });

<span class="c">// Add a job — runs immediately</span>
<span class="k">await</span> queue.add(<span class="s">'welcome'</span>, { <span class="v">email</span>: <span class="s">'user@example.com'</span> });

<span class="c">// Schedule a job — runs in 30 seconds</span>
<span class="k">await</span> queue.add(<span class="s">'reminder'</span>, { <span class="v">email</span>: <span class="s">'user@example.com'</span> }, {
  <span class="v">delay</span>: <span class="n">30_000</span>,
});</code></pre>
        </div>
      </div>
    </section>

    <!-- ─── Runtimes Section ──────────────────────── -->
    <section class="runtimes-section">
      <div class="runtimes-container">
        <h2 class="section-label">Runs everywhere</h2>
        <div class="runtime-cards">
          <div class="runtime-card">
            <div class="runtime-logo deno">
              <svg viewBox="0 0 512 512" width="40" height="40">
                <path d="M256 0C114.6 0 0 114.6 0 256s114.6 256 256 256 256-114.6 256-256S397.4 0 256 0z" fill="currentColor"/>
                <path d="M256 28.5c125.6 0 227.5 101.9 227.5 227.5S381.6 483.5 256 483.5 28.5 381.6 28.5 256 130.4 28.5 256 28.5z" fill="var(--vp-c-bg)"/>
                <path d="M376 256c0-66.3-53.7-120-120-120s-120 53.7-120 120c0 45.5 25.3 85.1 62.6 105.4L212 298c-4.4-10.2-6.9-21.3-6.9-33 0-46.4 37.6-84 84-84s84 37.6 84 84c0 11.7-2.4 22.8-6.7 32.9l13.5 43.4C404.3 321 376 291.5 376 256z" fill="currentColor"/>
                <circle cx="317" cy="232" r="16" fill="currentColor"/>
                <path d="M261 256l15.5 88.3c.8 4.5-2.2 8.8-6.7 9.6l-.5.1c-4.5.8-8.8-2.2-9.6-6.7L244.2 259" stroke="currentColor" stroke-width="8" fill="none"/>
              </svg>
            </div>
            <span class="runtime-name">Deno 2</span>
            <span class="runtime-badge native">Native</span>
          </div>
          <div class="runtime-card">
            <div class="runtime-logo node">
              <svg viewBox="0 0 256 289" width="36" height="40">
                <path d="M128 288.464c-3.975 0-7.685-1.06-11.13-2.915l-35.247-20.936c-5.3-2.915-2.65-3.975-1.06-4.505 7.155-2.385 8.48-2.915 15.9-7.155.795-.53 1.855-.265 2.65.265l27.032 16.166c1.06.53 2.385.53 3.18 0l105.74-61.217c1.06-.53 1.59-1.59 1.59-2.915V83.08c0-1.325-.53-2.385-1.59-2.915L128.795 19.213c-1.06-.53-2.385-.53-3.18 0L19.875 80.165c-1.06.53-1.59 1.855-1.59 2.915v122.17c0 1.06.53 2.385 1.59 2.915l28.887 16.695c15.635 7.95 25.44-1.325 25.44-10.6V93.15c0-1.59 1.325-3.18 3.18-3.18h13.25c1.59 0 3.18 1.325 3.18 3.18v121.11c0 20.936-11.395 33.126-31.27 33.126-6.095 0-10.865 0-24.38-6.625L11.13 224.6C4.24 220.625 0 213.205 0 205.25V83.08c0-7.95 4.24-15.37 11.13-19.345L116.87 2.518c6.625-3.71 15.635-3.71 22.26 0L244.87 63.735c6.89 3.975 11.13 11.395 11.13 19.345v122.17c0 7.95-4.24 15.37-11.13 19.345L139.13 285.549c-3.445 1.855-7.42 2.915-11.13 2.915z" fill="currentColor"/>
              </svg>
            </div>
            <span class="runtime-name">Node.js 18+</span>
            <span class="runtime-badge">Supported</span>
          </div>
          <div class="runtime-card">
            <div class="runtime-logo bun">
              <svg viewBox="0 0 80 80" width="40" height="40">
                <circle cx="40" cy="40" r="38" fill="currentColor"/>
                <circle cx="40" cy="40" r="35" fill="var(--vp-c-bg)"/>
                <ellipse cx="30" cy="35" rx="4" ry="6" fill="currentColor"/>
                <ellipse cx="50" cy="35" rx="4" ry="6" fill="currentColor"/>
                <path d="M28 48 Q40 58 52 48" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/>
              </svg>
            </div>
            <span class="runtime-name">Bun 1.1+</span>
            <span class="runtime-badge">Supported</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ─── Stores Section ────────────────────────── -->
    <section class="stores-section">
      <div class="stores-container">
        <h2 class="section-label">Pick your backend</h2>
        <p class="section-sub">Switch stores in one line. Zero lock-in, identical API.</p>

        <div class="store-cards">
          <a href="/stores/postgresql" class="store-card">
            <div class="store-icon pg">
              <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7"/>
                <ellipse cx="12" cy="7" rx="8" ry="4"/>
                <path d="M4 12c0 2.21 3.582 4 8 4s8-1.79 8-4"/>
              </svg>
            </div>
            <h4>PostgreSQL</h4>
            <p>Production-grade. LISTEN/NOTIFY for real-time events, row-level locking.</p>
            <span class="store-tag">Recommended for production</span>
          </a>
          <a href="/stores/sqlite" class="store-card">
            <div class="store-icon sqlite">
              <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
            <h4>SQLite</h4>
            <p>Embedded. WAL mode, zero config. Deno, Node.js, and Bun drivers.</p>
            <span class="store-tag">Great for edge & embedded</span>
          </a>
          <a href="/stores/memory" class="store-card">
            <div class="store-icon mem">
              <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="4" y="4" width="16" height="16" rx="2"/>
                <path d="M9 9h6v6H9z"/>
                <path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/>
              </svg>
            </div>
            <h4>In-Memory</h4>
            <p>Zero dependencies. Instant tests, no infrastructure. Perfect for development.</p>
            <span class="store-tag">Best for testing</span>
          </a>
        </div>
      </div>
    </section>

    <!-- ─── CTA Section ───────────────────────────── -->
    <section class="cta-section">
      <div class="cta-container">
        <h2>Ready to ditch Redis?</h2>
        <p>Get started in under a minute. Full TypeScript, zero infrastructure.</p>
        <a href="/guide/getting-started" class="btn btn-primary btn-lg">
          <span>Read the docs</span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M6 3L11 8L6 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </a>
      </div>
    </section>
  </div>
</template>

<script lang="ts">
const features = [
  {
    icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
    title: 'Scheduling',
    details: 'Delays, cron expressions, and human-readable intervals like "every 2 hours" or "in 10 minutes".',
  },
  {
    icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
    title: 'Retry & Backoff',
    details: 'Fixed, exponential, or custom backoff. Configure max attempts, delays, and failure handling.',
  },
  {
    icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>',
    title: 'Concurrency',
    details: 'Per-worker and global cross-worker concurrency limits with distributed locking.',
  },
  {
    icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 20V10M18 20V4M6 20v-4"/></svg>',
    title: 'Rate Limiting',
    details: 'Sliding window rate limiter. Set max jobs per duration to protect downstream services.',
  },
  {
    icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0-6h18"/></svg>',
    title: 'Flows & Dependencies',
    details: 'Parent-child job trees. A parent waits until all children complete before executing.',
  },
  {
    icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
    title: 'Observables & Events',
    details: 'Reactive job observables and a rich event bus — progress, stalled, drained, and more.',
  },
];

export default {
  setup() {
    return { features };
  },
};
</script>

<style scoped>
/* ─── Variables ──────────────────────────────────── */
.conveyor-home {
  --c-brand: #F07623;
  --c-brand-light: #FF9A52;
  --c-brand-glow: rgba(240, 118, 35, 0.3);
  --c-cyan: #22D3EE;
  --c-cyan-glow: rgba(34, 211, 238, 0.2);
  --c-green: #34D399;
  --c-violet: #A78BFA;
  --c-surface: #111827;
  --c-surface-2: #1C2433;
  --c-border: #2A3344;
  --c-text: #E2E8F0;
  --c-text-muted: #94A3B8;

  font-family: 'Plus Jakarta Sans', var(--vp-font-family-base);
  color: var(--c-text);
  overflow: hidden;
}

/* ─── Hero Section ───────────────────────────────── */
.hero {
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 6rem 2rem 2rem;
  overflow: hidden;
}

.hero-grid-bg {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(42, 51, 68, 0.3) 1px, transparent 1px),
    linear-gradient(90deg, rgba(42, 51, 68, 0.3) 1px, transparent 1px);
  background-size: 60px 60px;
  mask-image: radial-gradient(ellipse 80% 70% at 50% 40%, black 30%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 80% 70% at 50% 40%, black 30%, transparent 100%);
}

.hero-glow {
  position: absolute;
  top: 10%;
  left: 50%;
  transform: translateX(-50%);
  width: 800px;
  height: 500px;
  background: radial-gradient(ellipse, var(--c-brand-glow) 0%, transparent 70%);
  filter: blur(80px);
  opacity: 0.5;
  pointer-events: none;
}

.hero-content {
  position: relative;
  z-index: 1;
  text-align: center;
  max-width: 800px;
}

.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  border-radius: 100px;
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--c-text-muted);
  letter-spacing: 0.02em;
  margin-bottom: 2rem;
  opacity: 0;
  transform: translateY(12px);
  animation: fadeUp 0.6s ease forwards;
  animation-delay: 0.2s;
}

.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c-green);
  animation: pulse-dot 2s ease infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.5); }
  50% { opacity: 0.7; box-shadow: 0 0 0 6px rgba(52, 211, 153, 0); }
}

.hero-title {
  font-family: 'Bricolage Grotesque', var(--vp-font-family-base);
  font-size: clamp(3rem, 8vw, 5.5rem);
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: -0.03em;
  margin: 0 0 1.5rem;
}

.title-line {
  display: block;
  opacity: 0;
  transform: translateY(20px);
  animation: fadeUp 0.7s ease forwards;
}

.line-1 {
  color: var(--c-text);
  animation-delay: 0.35s;
}

.line-2 {
  animation-delay: 0.5s;
}

.line-2 em {
  font-style: normal;
  background: linear-gradient(135deg, var(--c-brand) 0%, var(--c-brand-light) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.hero-tagline {
  font-size: 1.15rem;
  line-height: 1.7;
  color: var(--c-text-muted);
  max-width: 560px;
  margin: 0 auto 2.5rem;
  opacity: 0;
  transform: translateY(16px);
  animation: fadeUp 0.6s ease forwards;
  animation-delay: 0.65s;
}

.hero-actions {
  display: flex;
  justify-content: center;
  gap: 1rem;
  opacity: 0;
  transform: translateY(16px);
  animation: fadeUp 0.6s ease forwards;
  animation-delay: 0.8s;
}

@keyframes fadeUp {
  to { opacity: 1; transform: translateY(0); }
}

/* ─── Buttons ────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 28px;
  border-radius: 10px;
  font-family: 'Bricolage Grotesque', var(--vp-font-family-base);
  font-weight: 700;
  font-size: 0.95rem;
  text-decoration: none;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  cursor: pointer;
  border: none;
}

.btn-primary {
  background: linear-gradient(135deg, var(--c-brand) 0%, #E85D04 100%);
  color: #fff;
  box-shadow: 0 4px 24px var(--c-brand-glow), 0 1px 2px rgba(0,0,0,0.3);
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 32px var(--c-brand-glow), 0 2px 4px rgba(0,0,0,0.3);
}

.btn-ghost {
  background: var(--c-surface);
  color: var(--c-text);
  border: 1px solid var(--c-border);
}

.btn-ghost:hover {
  border-color: var(--c-text-muted);
  background: var(--c-surface-2);
  transform: translateY(-2px);
}

.btn-lg {
  padding: 16px 36px;
  font-size: 1.05rem;
}

/* ─── Conveyor Belt Animation ────────────────────── */
.conveyor-track {
  position: relative;
  width: 100%;
  max-width: 900px;
  margin: 4rem auto 0;
  height: 100px;
  opacity: 0;
  animation: fadeUp 0.8s ease forwards;
  animation-delay: 1s;
}

.track-line {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--c-border);
  transform: translateY(-50%);
}

.track-zones {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-around;
  padding: 0 5%;
}

.zone {
  font-family: 'Fira Code', monospace;
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  padding: 3px 12px;
  border-radius: 4px;
  border: 1px solid;
}

.zone-waiting { color: var(--c-brand); border-color: rgba(240, 118, 35, 0.3); background: rgba(240, 118, 35, 0.08); }
.zone-active { color: var(--c-cyan); border-color: rgba(34, 211, 238, 0.3); background: rgba(34, 211, 238, 0.08); }
.zone-done { color: var(--c-green); border-color: rgba(52, 211, 153, 0.3); background: rgba(52, 211, 153, 0.08); }

.jobs-stream {
  position: absolute;
  top: 50%;
  left: 0;
  width: 100%;
  height: 28px;
  transform: translateY(-50%);
}

.job-box {
  position: absolute;
  top: 0;
  left: -60px;
  width: 54px;
  height: 28px;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Fira Code', monospace;
  font-size: 0.6rem;
  font-weight: 500;
  color: #fff;
  animation: convey 8s linear infinite;
  will-change: transform;
}

.j1 { animation-delay: 0s; }
.j2 { animation-delay: 1s; }
.j3 { animation-delay: 2s; }
.j4 { animation-delay: 3s; }
.j5 { animation-delay: 4s; }
.j6 { animation-delay: 5s; }
.j7 { animation-delay: 6s; }
.j8 { animation-delay: 7s; }

@keyframes convey {
  0% {
    transform: translateX(0);
    background: var(--c-brand);
    box-shadow: 0 0 12px var(--c-brand-glow);
    opacity: 0;
  }
  5% { opacity: 1; }
  0%, 33% {
    background: var(--c-brand);
    box-shadow: 0 0 12px var(--c-brand-glow);
  }
  40%, 60% {
    background: #0E7490;
    box-shadow: 0 0 12px var(--c-cyan-glow);
  }
  67%, 95% {
    background: #059669;
    box-shadow: 0 0 12px rgba(52, 211, 153, 0.3);
  }
  95% { opacity: 1; }
  100% {
    transform: translateX(calc(900px + 60px));
    background: #059669;
    opacity: 0;
  }
}

.track-teeth {
  position: absolute;
  bottom: 8px;
  left: 0;
  right: 0;
  display: flex;
  gap: 4px;
  overflow: hidden;
  animation: teeth-scroll 2s linear infinite;
}

.tooth {
  flex-shrink: 0;
  width: 18px;
  height: 4px;
  border-radius: 2px;
  background: var(--c-border);
  opacity: 0.5;
}

@keyframes teeth-scroll {
  0% { transform: translateX(0); }
  100% { transform: translateX(-22px); }
}

/* ─── Features Section ───────────────────────────── */
.features-section {
  position: relative;
  padding: 8rem 2rem;
}

.features-container,
.code-container,
.runtimes-container,
.stores-container,
.cta-container {
  max-width: 1100px;
  margin: 0 auto;
}

.section-label {
  font-family: 'Bricolage Grotesque', var(--vp-font-family-base);
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  text-align: center;
  margin-bottom: 3.5rem;
}

.section-sub {
  text-align: center;
  color: var(--c-text-muted);
  margin-top: -2.5rem;
  margin-bottom: 3rem;
  font-size: 1.05rem;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.5rem;
}

.feature-card {
  padding: 2rem;
  border-radius: 14px;
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  opacity: 0;
  transform: translateY(20px);
  animation: fadeUp 0.5s ease forwards;
  animation-delay: var(--delay);
}

.conveyor-home.visible .feature-card {
  opacity: 0;
  animation: fadeUp 0.5s ease forwards;
  animation-delay: calc(1.2s + var(--delay));
}

.feature-card:hover {
  border-color: rgba(240, 118, 35, 0.3);
  background: var(--c-surface-2);
  transform: translateY(-4px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(240, 118, 35, 0.1);
}

.feature-icon {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: rgba(240, 118, 35, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1rem;
  color: var(--c-brand);
}

.feature-card h3 {
  font-family: 'Bricolage Grotesque', var(--vp-font-family-base);
  font-size: 1.1rem;
  font-weight: 700;
  margin: 0 0 0.5rem;
  color: var(--c-text);
}

.feature-card p {
  font-size: 0.9rem;
  line-height: 1.6;
  color: var(--c-text-muted);
  margin: 0;
}

/* ─── Code Section ───────────────────────────────── */
.code-section {
  padding: 4rem 2rem 8rem;
}

.code-window {
  border-radius: 14px;
  border: 1px solid var(--c-border);
  background: #0D1117;
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.4);
}

.code-chrome {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--c-border);
  background: rgba(17, 24, 39, 0.8);
}

.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.dot.red { background: #FF5F57; }
.dot.yellow { background: #FFBD2E; }
.dot.green { background: #28CA42; }

.code-filename {
  margin-left: 12px;
  font-family: 'Fira Code', monospace;
  font-size: 0.75rem;
  color: var(--c-text-muted);
}

.code-body {
  padding: 1.5rem 2rem;
  margin: 0;
  overflow-x: auto;
  line-height: 1.8;
  font-size: 0.85rem;
}

.code-body code {
  font-family: 'Fira Code', monospace;
  color: #E2E8F0;
}

.code-body .k { color: #C084FC; } /* keywords — violet */
.code-body .t { color: #22D3EE; } /* types — cyan */
.code-body .s { color: #34D399; } /* strings — green */
.code-body .v { color: #E2E8F0; } /* variables */
.code-body .n { color: #F59E0B; } /* numbers — amber */
.code-body .c { color: #64748B; font-style: italic; } /* comments */

/* ─── Runtimes Section ───────────────────────────── */
.runtimes-section {
  padding: 4rem 2rem 6rem;
}

.runtime-cards {
  display: flex;
  justify-content: center;
  gap: 2rem;
  flex-wrap: wrap;
}

.runtime-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 2rem 3rem;
  border-radius: 14px;
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  transition: all 0.3s ease;
}

.runtime-card:hover {
  border-color: var(--c-text-muted);
  transform: translateY(-4px);
}

.runtime-logo {
  color: var(--c-text);
}

.runtime-name {
  font-family: 'Bricolage Grotesque', var(--vp-font-family-base);
  font-weight: 700;
  font-size: 1rem;
}

.runtime-badge {
  font-family: 'Fira Code', monospace;
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 2px 10px;
  border-radius: 100px;
  background: rgba(148, 163, 184, 0.1);
  color: var(--c-text-muted);
  border: 1px solid var(--c-border);
}

.runtime-badge.native {
  background: rgba(52, 211, 153, 0.1);
  color: var(--c-green);
  border-color: rgba(52, 211, 153, 0.3);
}

/* ─── Stores Section ─────────────────────────────── */
.stores-section {
  padding: 4rem 2rem 8rem;
}

.store-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.5rem;
}

.store-card {
  padding: 2rem;
  border-radius: 14px;
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  text-decoration: none;
  color: inherit;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
}

.store-card:hover {
  border-color: rgba(240, 118, 35, 0.3);
  transform: translateY(-4px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
}

.store-icon {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1.25rem;
}

.store-icon.pg { background: rgba(34, 211, 238, 0.1); color: var(--c-cyan); }
.store-icon.sqlite { background: rgba(167, 139, 250, 0.1); color: var(--c-violet); }
.store-icon.mem { background: rgba(52, 211, 153, 0.1); color: var(--c-green); }

.store-card h4 {
  font-family: 'Bricolage Grotesque', var(--vp-font-family-base);
  font-weight: 700;
  font-size: 1.15rem;
  margin: 0 0 0.5rem;
}

.store-card p {
  font-size: 0.9rem;
  line-height: 1.6;
  color: var(--c-text-muted);
  margin: 0 0 auto;
  padding-bottom: 1rem;
}

.store-tag {
  font-family: 'Fira Code', monospace;
  font-size: 0.65rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(240, 118, 35, 0.08);
  color: var(--c-brand);
  border: 1px solid rgba(240, 118, 35, 0.2);
  align-self: flex-start;
}

/* ─── CTA Section ────────────────────────────────── */
.cta-section {
  padding: 6rem 2rem 8rem;
  text-align: center;
}

.cta-container h2 {
  font-family: 'Bricolage Grotesque', var(--vp-font-family-base);
  font-size: clamp(2rem, 5vw, 3rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  margin-bottom: 1rem;
}

.cta-container p {
  color: var(--c-text-muted);
  font-size: 1.1rem;
  margin-bottom: 2rem;
}

/* ─── Light Mode Overrides ───────────────────────── */
:root:not(.dark) .conveyor-home {
  --c-surface: #F8FAFC;
  --c-surface-2: #F1F5F9;
  --c-border: #E2E8F0;
  --c-text: #0F172A;
  --c-text-muted: #64748B;
  --c-brand-glow: rgba(240, 118, 35, 0.15);
}

:root:not(.dark) .hero-grid-bg {
  background-image:
    linear-gradient(rgba(148, 163, 184, 0.2) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.2) 1px, transparent 1px);
}

:root:not(.dark) .hero-glow {
  opacity: 0.3;
}

:root:not(.dark) .code-window {
  background: #1E293B;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.12);
}

:root:not(.dark) .btn-ghost {
  background: #fff;
}

/* ─── Responsive ─────────────────────────────────── */
@media (max-width: 768px) {
  .hero { padding: 4rem 1.5rem 2rem; min-height: auto; }
  .hero-title { font-size: 2.5rem; }
  .features-grid { grid-template-columns: 1fr; }
  .store-cards { grid-template-columns: 1fr; }
  .hero-actions { flex-direction: column; align-items: center; }
  .runtime-cards { flex-direction: column; align-items: center; }
  .conveyor-track { display: none; }
  .code-body { font-size: 0.75rem; padding: 1rem; }
}

@media (max-width: 1024px) and (min-width: 769px) {
  .features-grid { grid-template-columns: repeat(2, 1fr); }
  .store-cards { grid-template-columns: repeat(2, 1fr); }
}
</style>
