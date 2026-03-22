<script setup lang="ts">
import { ref, onMounted } from 'vue';
import versions from '../../../versions.json';

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
          {{ versions.fullVersion }} &mdash; Open Source
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
          <div class="zone zone-waiting"><span>WAITING</span></div>
          <div class="zone zone-active"><span>PROCESSING</span></div>
          <div class="zone zone-done"><span>DONE</span></div>
        </div>
        <div class="jobs-stream">
          <div class="job-box j1">
            <span class="jb-name">email</span>
            <span class="jb-tag tag-delay">30s</span>
          </div>
          <div class="job-box j2">
            <span class="jb-name">resize</span>
            <span class="jb-tag tag-prio">high</span>
          </div>
          <div class="job-box j3">
            <span class="jb-name">deploy</span>
            <span class="jb-tag tag-flow">flow</span>
          </div>
          <div class="job-box j4">
            <span class="jb-name">sync</span>
            <span class="jb-tag tag-retry">2/3</span>
          </div>
          <div class="job-box j5">
            <span class="jb-name">notify</span>
            <span class="jb-tag tag-cron">cron</span>
          </div>
        </div>
        <div class="track-teeth">
          <span v-for="n in 48" :key="n" class="tooth"></span>
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
              <!-- Deno logo (Simple Icons) -->
              <svg viewBox="0 0 24 24" width="44" height="44" fill="currentColor">
                <path d="M1.105 18.02A11.9 11.9 0 0 1 0 12.985q0-.698.078-1.376a12 12 0 0 1 .231-1.34A12 12 0 0 1 4.025 4.02a12 12 0 0 1 5.46-2.771 12 12 0 0 1 3.428-.23c1.452.112 2.825.477 4.077 1.05a12 12 0 0 1 2.78 1.774 12.02 12.02 0 0 1 4.053 7.078A12 12 0 0 1 24 12.985q0 .454-.036.914a12 12 0 0 1-.728 3.305 12 12 0 0 1-2.38 3.875c-1.33 1.357-3.02 1.962-4.43 1.936a4.4 4.4 0 0 1-2.724-1.024c-.99-.853-1.391-1.83-1.53-2.919a5 5 0 0 1 .128-1.518c.105-.38.37-1.116.76-1.437-.455-.197-1.04-.624-1.226-.829-.045-.05-.04-.13 0-.183a.155.155 0 0 1 .177-.053c.392.134.869.267 1.372.35.66.111 1.484.25 2.317.292 2.03.1 4.153-.813 4.812-2.627s.403-3.609-1.96-4.685-3.454-2.356-5.363-3.128c-1.247-.505-2.636-.205-4.06.582-3.838 2.121-7.277 8.822-5.69 15.032a.191.191 0 0 1-.315.19 12 12 0 0 1-1.25-1.634 12 12 0 0 1-.769-1.404M11.57 6.087c.649-.051 1.214.501 1.31 1.236.13.979-.228 1.99-1.41 2.013-1.01.02-1.315-.997-1.248-1.614.066-.616.574-1.575 1.35-1.635"/>
              </svg>
            </div>
            <span class="runtime-name">Deno 2</span>
            <span class="runtime-badge native">Native</span>
          </div>
          <div class="runtime-card">
            <div class="runtime-logo node">
              <!-- Official Node.js logo -->
              <svg viewBox="0 0 426.95 485.988" width="38" height="44">
                <defs>
                  <linearGradient id="node-a" x1="310.495" x2="116.427" y1="44.907" y2="441.049" gradientUnits="userSpaceOnUse"><stop offset=".3" stop-color="#3e863d"/><stop offset=".5" stop-color="#55934f"/><stop offset=".8" stop-color="#5aad45"/></linearGradient>
                  <linearGradient id="node-b" x1="21.339" x2="409.585" y1="389.396" y2="102.11" gradientUnits="userSpaceOnUse"><stop offset=".57" stop-color="#3e863d"/><stop offset=".72" stop-color="#619857"/><stop offset="1" stop-color="#76ac64"/></linearGradient>
                  <linearGradient id="node-c" x1="12.058" x2="426.643" y1="242.887" y2="242.887" gradientUnits="userSpaceOnUse"><stop offset=".16" stop-color="#6bbf47"/><stop offset=".38" stop-color="#79b461"/><stop offset=".47" stop-color="#75ac64"/><stop offset=".7" stop-color="#659e5a"/><stop offset=".9" stop-color="#3e863d"/></linearGradient>
                </defs>
                <path fill="url(#node-a)" d="M201.985 3.074 11.511 113.014A22.99 22.99 0 0 0 0 132.934v220.033a22.98 22.98 0 0 0 11.511 19.92L202 482.912a23.06 23.06 0 0 0 23.013 0l190.454-110.025a23.04 23.04 0 0 0 11.483-19.92V132.934a22.99 22.99 0 0 0-11.528-19.92L224.993 3.074a23.16 23.16 0 0 0-23.058 0"/>
                <path fill="url(#node-b)" d="M4.72 366.937a23 23 0 0 0 6.782 5.95l163.392 94.378 27.217 15.643a23.1 23.1 0 0 0 13.265 3.007 23.6 23.6 0 0 0 4.521-.828L420.788 117.25a22.8 22.8 0 0 0-5.353-4.25L290.716 40.979 224.789 3.047a24 24 0 0 0-5.968-2.4Z"/>
                <path fill="url(#node-c)" d="M211.19.127a23.2 23.2 0 0 0-9.2 2.947L12.058 112.7l204.806 373.034a22.9 22.9 0 0 0 8.183-2.822l190.474-110.025a23.08 23.08 0 0 0 11.122-15.715L217.858.5A24 24 0 0 0 213.2.041q-.95 0-1.9.09"/>
              </svg>
            </div>
            <span class="runtime-name">Node.js 18+</span>
            <span class="runtime-badge">Supported</span>
          </div>
          <div class="runtime-card">
            <div class="runtime-logo bun">
              <!-- Official Bun logo -->
              <svg viewBox="0 0 24 24" width="44" height="44" fill="currentColor">
                <path d="M12 22.596c6.628 0 12-4.338 12-9.688 0-3.318-2.057-6.248-5.219-7.986-1.286-.715-2.297-1.357-3.139-1.89C14.058 2.025 13.08 1.404 12 1.404c-1.097 0-2.334.785-3.966 1.821a49.92 49.92 0 0 1-2.816 1.697C2.057 6.66 0 9.59 0 12.908c0 5.35 5.372 9.687 12 9.687v.001ZM10.599 4.715c.334-.759.503-1.58.498-2.409 0-.145.202-.187.23-.029.658 2.783-.902 4.162-2.057 4.624-.124.048-.199-.121-.103-.209a5.763 5.763 0 0 0 1.432-1.977Zm2.058-.102a5.82 5.82 0 0 0-.782-2.306v-.016c-.069-.123.086-.263.185-.172 1.962 2.111 1.307 4.067.556 5.051-.082.103-.23-.003-.189-.126a5.85 5.85 0 0 0 .23-2.431Zm1.776-.561a5.727 5.727 0 0 0-1.612-1.806v-.014c-.112-.085-.024-.274.114-.218 2.595 1.087 2.774 3.18 2.459 4.407a.116.116 0 0 1-.049.071.11.11 0 0 1-.153-.026.122.122 0 0 1-.022-.083 5.891 5.891 0 0 0-.737-2.331Zm-5.087.561c-.617.546-1.282.76-2.063 1-.117 0-.195-.078-.156-.181 1.752-.909 2.376-1.649 2.999-2.778 0 0 .155-.118.188.085 0 .304-.349 1.329-.968 1.874Zm4.945 11.237a2.957 2.957 0 0 1-.937 1.553c-.346.346-.8.565-1.286.62a2.178 2.178 0 0 1-1.327-.62 2.955 2.955 0 0 1-.925-1.553.244.244 0 0 1 .064-.198.234.234 0 0 1 .193-.069h3.965a.226.226 0 0 1 .19.07c.05.053.073.125.063.197Zm-5.458-2.176a1.862 1.862 0 0 1-2.384-.245 1.98 1.98 0 0 1-.233-2.447c.207-.319.503-.566.848-.713a1.84 1.84 0 0 1 1.092-.11c.366.075.703.261.967.531a1.98 1.98 0 0 1 .408 2.114 1.931 1.931 0 0 1-.698.869v.001Zm8.495.005a1.86 1.86 0 0 1-2.381-.253 1.964 1.964 0 0 1-.547-1.366c0-.384.11-.76.32-1.079.207-.319.503-.567.849-.713a1.844 1.844 0 0 1 1.093-.108c.367.076.704.262.968.534a1.98 1.98 0 0 1 .4 2.117 1.932 1.932 0 0 1-.702.868Z"/>
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
              <!-- Official PostgreSQL Slonik -->
              <svg viewBox="0 0 512 512" width="36" height="36">
                <path d="M378.5 372.5c3.2-26.9 2.3-30.8 22.3-26.5l5.1.4c15.4.7 35.5-2.5 47.4-8 25.5-11.8 40.6-31.5 15.5-26.4-57.3 11.8-61.2-7.6-61.2-7.6 60.5-89.7 85.8-203.6 63.9-231.5C411.9-3 308.8 33 307.1 33.9l-.5.1c-11.3-2.3-24-3.8-38.2-4-25.9-.4-45.6 6.8-60.5 18.1 0 0-183.8-75.7-175.2 95.2 1.8 36.4 52.1 275.2 112.1 203 21.9-26.4 43.1-48.7 43.1-48.7 10.5 7 23.1 10.6 36.3 9.3l1-.9c-.3 3.3-.2 6.5.4 10.3-15.5 17.3-10.9 20.3-41.8 26.7-31.3 6.4-12.9 17.9-.9 20.9 14.5 3.6 48.2 8.8 70.9-23l-.9 3.6c6.1 4.9 10.3 31.6 9.6 55.8s-1.2 40.8 3.6 53.8 9.5 42.2 50.1 33.5c33.9-7.3 51.5-26.1 54-57.6 1.7-22.4 5.7-19 5.9-39l3.2-9.5c3.6-30.3.6-40.1 21.5-35.5l5.1.4c15.4.7 35.5-2.5 47.4-8 25.5-11.7 40.5-31.4 15.5-26.3" fill="#336791"/>
                <path d="M256.3 329.5c-1.6 56.4.4 113.2 5.9 126.9 5.5 13.8 17.3 40.6 58 31.9 33.9-7.3 46.3-21.4 51.6-52.4 3.9-22.9 11.6-86.4 12.5-99.4M207.6 46.9S23.7-28.3 32.2 142.7c1.8 36.4 52.1 275.2 112.1 203 21.9-26.4 41.8-47.1 41.8-47.1M306.9 33.2c-6.4 2 102.3-39.7 164.1 39.2 21.8 27.9-3.5 141.8-63.9 231.5" fill="none" stroke="#fff" stroke-width="12.465" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M407 303.9s3.9 19.4 61.2 7.6c25.1-5.2 10 14.5-15.5 26.4-20.9 9.7-67.7 12.2-68.5-1.2-1.9-34.7 24.8-24.2 22.8-32.8-1.7-7.8-13.6-15.5-21.5-34.5-6.9-16.7-94.3-144.4 24.2-125.5 4.3-.9-30.9-112.7-141.8-114.5S160.7 165.8 160.7 165.8" fill="none" stroke="#fff" stroke-width="12.465" stroke-linecap="round" stroke-linejoin="bevel"/>
                <path d="M225.2 315.7c-15.5 17.3-10.9 20.3-41.8 26.7-31.3 6.4-12.9 17.9-.9 20.9 14.5 3.6 48.2 8.8 70.9-23 6.9-9.7 0-25.1-9.5-29.1-4.6-2-10.8-4.4-18.7 4.5M224.2 315.4c-1.6-10.2 3.3-22.2 8.6-36.4 7.9-21.2 26.1-42.4 11.5-109.7-10.8-50.1-83.6-10.4-83.6-3.6s3.3 34.5-1.2 66.7c-5.9 42 26.7 77.6 64.3 73.9" fill="none" stroke="#fff" stroke-width="12.465" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M206.9 164.7c-.3 2.3 4.3 8.5 10.2 9.3 6 .8 11.1-4 11.4-6.3s-4.2-4.9-10.2-5.7c-6-.9-11.1.3-11.4 2.7z" fill="#fff" stroke="#fff" stroke-width="4.155"/>
                <path d="M388.4 159.9c.3 2.3-4.2 8.5-10.2 9.3s-11.1-4-11.4-6.3 4.3-4.9 10.2-5.7 11.1.4 11.4 2.7z" fill="#fff" stroke="#fff" stroke-width="2.078"/>
                <path d="M409.8 143.9c1 18.2-3.9 30.6-4.5 50-.9 28.2 13.4 60.4-8.2 92.7" fill="none" stroke="#fff" stroke-width="12.465" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <h4>PostgreSQL</h4>
            <p>Production-grade. LISTEN/NOTIFY for real-time events, row-level locking.</p>
            <span class="store-tag">Recommended for production</span>
          </a>
          <a href="/stores/sqlite" class="store-card">
            <div class="store-icon sqlite">
              <!-- Official SQLite logo -->
              <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
                <path d="M21.678.521c-1.032-.92-2.28-.55-3.513.544a8.71 8.71 0 0 0-.547.535c-2.109 2.237-4.066 6.38-4.674 9.544.237.48.422 1.093.544 1.561a13.044 13.044 0 0 1 .164.703s-.019-.071-.096-.296l-.05-.146a1.689 1.689 0 0 0-.033-.08c-.138-.32-.518-.995-.686-1.289-.143.423-.27.818-.376 1.176.484.884.778 2.4.778 2.4s-.025-.099-.147-.442c-.107-.303-.644-1.244-.772-1.464-.217.804-.304 1.346-.226 1.478.152.256.296.698.422 1.186.286 1.1.485 2.44.485 2.44l.017.224a22.41 22.41 0 0 0 .056 2.748c.095 1.146.273 2.13.5 2.657l.155-.084c-.334-1.038-.47-2.399-.41-3.967.09-2.398.642-5.29 1.661-8.304 1.723-4.55 4.113-8.201 6.3-9.945-1.993 1.8-4.692 7.63-5.5 9.788-.904 2.416-1.545 4.684-1.931 6.857.666-2.037 2.821-2.912 2.821-2.912s1.057-1.304 2.292-3.166c-.74.169-1.955.458-2.362.629-.6.251-.762.337-.762.337s1.945-1.184 3.613-1.72C21.695 7.9 24.195 2.767 21.678.521m-18.573.543A1.842 1.842 0 0 0 1.27 2.9v16.608a1.84 1.84 0 0 0 1.835 1.834h9.418a22.953 22.953 0 0 1-.052-2.707c-.006-.062-.011-.141-.016-.2a27.01 27.01 0 0 0-.473-2.378c-.121-.47-.275-.898-.369-1.057-.116-.197-.098-.31-.097-.432 0-.12.015-.245.037-.386a9.98 9.98 0 0 1 .234-1.045l.217-.028c-.017-.035-.014-.065-.031-.097l-.041-.381a32.8 32.8 0 0 1 .382-1.194l.2-.019c-.008-.016-.01-.038-.018-.053l-.043-.316c.63-3.28 2.587-7.443 4.8-9.791.066-.069.133-.128.198-.194Z"/>
              </svg>
            </div>
            <h4>SQLite</h4>
            <p>Embedded. WAL mode, zero config. Deno, Node.js, and Bun drivers.</p>
            <span class="store-tag">Great for edge & embedded</span>
          </a>
          <a href="/stores/memory" class="store-card">
            <div class="store-icon mem">
              <!-- Memory / RAM chip -->
              <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="5" y="6" width="14" height="12" rx="1.5"/>
                <rect x="8" y="9" width="8" height="6" rx="1" fill="currentColor" opacity="0.15"/>
                <path d="M8 6V3m4 3V3m4 3V3M8 18v3m4-3v3m4-3v3"/>
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
    icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><circle cx="12" cy="12" r="10" opacity="0.15"/><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 7v5l3.5 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="2"/></svg>',
    title: 'Scheduling',
    details: 'Delays, cron expressions, and human-readable intervals like "every 2 hours" or "in 10 minutes".',
  },
  {
    icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M1 4v6h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 8v4l2.5 1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    title: 'Retry & Backoff',
    details: 'Fixed, exponential, or custom backoff. Configure max attempts, delays, and failure handling.',
  },
  {
    icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><rect x="3" y="3" width="7" height="7" rx="1.5" opacity="0.2"/><rect x="14" y="3" width="7" height="7" rx="1.5" opacity="0.35"/><rect x="3" y="14" width="7" height="7" rx="1.5" opacity="0.35"/><rect x="14" y="14" width="7" height="7" rx="1.5" opacity="0.5"/></svg>',
    title: 'Concurrency',
    details: 'Per-worker and global cross-worker concurrency limits with distributed locking.',
  },
  {
    icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><rect x="5" y="10" width="4" height="10" rx="1" opacity="0.2"/><rect x="10" y="6" width="4" height="14" rx="1" opacity="0.35"/><rect x="15" y="2" width="4" height="18" rx="1" opacity="0.5"/><path d="M3 20h18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    title: 'Rate Limiting',
    details: 'Sliding window rate limiter. Set max jobs per duration to protect downstream services.',
  },
  {
    icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><circle cx="12" cy="5" r="3.5" opacity="0.4"/><circle cx="5" cy="19" r="3" opacity="0.25"/><circle cx="19" cy="19" r="3" opacity="0.25"/><path d="M12 8.5v4M8.5 16.5l-2 1M15.5 16.5l2 1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    title: 'Flows & Dependencies',
    details: 'Parent-child job trees. A parent waits until all children complete before executing.',
  },
  {
    icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M2 12h4l3-8 6 16 3-8h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="12" r="2.5" opacity="0.25"/><circle cx="15" cy="12" r="2.5" opacity="0.25"/></svg>',
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
  --c-surface: #151D2B;
  --c-surface-2: #1E2838;
  --c-border: #2D3A4E;
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
  height: 110px;
  opacity: 0;
  animation: fadeUp 0.8s ease forwards;
  animation-delay: 1s;
  mask-image: linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%);
  -webkit-mask-image: linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%);
}

.track-line {
  position: absolute;
  top: 55%;
  left: 0;
  right: 0;
  height: 2px;
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
  padding: 0 8%;
}

.zone {
  font-family: 'Fira Code', monospace;
  font-size: 0.6rem;
  font-weight: 600;
  letter-spacing: 0.12em;
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
  top: 55%;
  left: 0;
  width: 100%;
  height: 36px;
  transform: translateY(-50%);
}

.job-box {
  position: absolute;
  top: 0;
  left: -120px;
  height: 36px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  font-family: 'Fira Code', monospace;
  color: #fff;
  animation: convey 10s linear infinite;
  will-change: transform;
  white-space: nowrap;
}

.jb-name {
  font-size: 0.6rem;
  font-weight: 600;
}

.jb-tag {
  font-size: 0.5rem;
  font-weight: 500;
  padding: 1px 5px;
  border-radius: 3px;
  opacity: 0.9;
}

.tag-delay { background: rgba(255, 255, 255, 0.15); }
.tag-prio { background: rgba(255, 200, 50, 0.25); color: #FFD866; }
.tag-retry { background: rgba(248, 81, 73, 0.25); color: #FF9A95; }
.tag-flow { background: rgba(99, 179, 237, 0.25); color: #90CDF4; }
.tag-cron { background: rgba(167, 139, 250, 0.25); color: #C4B5FD; }

.j1 { animation-delay: 0s; }
.j2 { animation-delay: -8s; }
.j3 { animation-delay: -6s; }
.j4 { animation-delay: -4s; }
.j5 { animation-delay: -2s; }

@keyframes convey {
  0% {
    transform: translateX(0);
  }
  0%, 30% {
    background: rgba(240, 118, 35, 0.7);
    box-shadow: 0 2px 12px var(--c-brand-glow);
  }
  37%, 60% {
    background: rgba(14, 116, 144, 0.7);
    box-shadow: 0 2px 12px var(--c-cyan-glow);
  }
  67%, 100% {
    background: rgba(5, 150, 105, 0.7);
    box-shadow: 0 2px 12px rgba(52, 211, 153, 0.25);
  }
  100% {
    transform: translateX(calc(900px + 120px));
  }
}

.track-teeth {
  position: absolute;
  bottom: 4px;
  left: 0;
  right: 0;
  display: flex;
  gap: 3px;
  overflow: hidden;
  animation: teeth-scroll 1.5s linear infinite;
}

.tooth {
  flex-shrink: 0;
  width: 16px;
  height: 3px;
  border-radius: 1.5px;
  background: var(--c-border);
  opacity: 0.4;
}

@keyframes teeth-scroll {
  0% { transform: translateX(0); }
  100% { transform: translateX(-19px); }
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
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s ease, border-color 0.3s ease;
}

.feature-card:hover {
  border-color: rgba(240, 118, 35, 0.4);
  transform: translateY(-4px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(240, 118, 35, 0.15);
}

.feature-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: rgba(240, 118, 35, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1.25rem;
  color: var(--c-brand);
}

.feature-card h3 {
  font-family: 'Bricolage Grotesque', var(--vp-font-family-base);
  font-size: 1.15rem;
  font-weight: 700;
  margin: 0 0 0.6rem;
  color: var(--c-text);
  letter-spacing: -0.01em;
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

.store-icon.pg { background: rgba(51, 103, 145, 0.1); }
.store-icon.sqlite { background: rgba(0, 130, 200, 0.08); color: #0F80CC; }
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
  --c-surface: #FFFFFF;
  --c-surface-2: #FFF7F0;
  --c-border: rgba(0, 0, 0, 0.06);
  --c-text: #1A1523;
  --c-text-muted: #6B6278;
  --c-brand-glow: rgba(240, 118, 35, 0.12);
  --c-cyan: #0891B2;
  --c-green: #059669;
  --c-violet: #7C3AED;
}

/* Hero — warm cream gradient instead of dark grid */
:root:not(.dark) .hero {
  background: linear-gradient(180deg, #FFFBF5 0%, #FFF4E8 40%, #FFFFFF 100%);
}

:root:not(.dark) .hero-grid-bg {
  background-image:
    linear-gradient(rgba(240, 118, 35, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(240, 118, 35, 0.06) 1px, transparent 1px);
  mask-image: radial-gradient(ellipse 60% 50% at 50% 40%, black 20%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 60% 50% at 50% 40%, black 20%, transparent 100%);
}

:root:not(.dark) .hero-glow {
  background: radial-gradient(ellipse, rgba(240, 118, 35, 0.12) 0%, rgba(255, 154, 82, 0.06) 50%, transparent 70%);
  opacity: 1;
  filter: blur(60px);
}

:root:not(.dark) .line-2 em {
  background: linear-gradient(135deg, #D4580A 0%, #F07623 100%);
  -webkit-background-clip: text;
  background-clip: text;
}

/* Cards — white with soft shadows instead of borders */
:root:not(.dark) .feature-card {
  background: #FFFFFF;
  border: 1px solid rgba(0, 0, 0, 0.04);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 4px 16px rgba(0, 0, 0, 0.03);
}

:root:not(.dark) .feature-card:hover {
  border-color: rgba(240, 118, 35, 0.15);
  box-shadow: 0 8px 32px rgba(240, 118, 35, 0.1), 0 2px 8px rgba(0, 0, 0, 0.06);
  background: #FFFBF7;
}

:root:not(.dark) .store-card {
  background: #FFFFFF;
  border: 1px solid rgba(0, 0, 0, 0.04);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 4px 16px rgba(0, 0, 0, 0.03);
}

:root:not(.dark) .store-card:hover {
  border-color: rgba(240, 118, 35, 0.15);
  box-shadow: 0 8px 32px rgba(240, 118, 35, 0.1), 0 2px 8px rgba(0, 0, 0, 0.06);
}

:root:not(.dark) .runtime-card {
  background: #FFFFFF;
  border: 1px solid rgba(0, 0, 0, 0.04);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 4px 16px rgba(0, 0, 0, 0.03);
}

:root:not(.dark) .runtime-card:hover {
  border-color: rgba(0, 0, 0, 0.08);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
}

/* Alternating section backgrounds */
:root:not(.dark) .features-section {
  background: #FAFAF8;
}

:root:not(.dark) .stores-section {
  background: #FAFAF8;
}

/* CTA — warm gradient */
:root:not(.dark) .cta-section {
  background: linear-gradient(180deg, #FFFFFF 0%, #FFF7F0 100%);
}

/* Code block — stays dark, but lighter shadow */
:root:not(.dark) .code-window {
  background: #1E293B;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.1), 0 8px 24px rgba(0, 0, 0, 0.06);
  border: 1px solid rgba(0, 0, 0, 0.08);
}

:root:not(.dark) .code-chrome {
  background: #1A2332;
  border-color: rgba(255, 255, 255, 0.06);
}

/* Buttons */
:root:not(.dark) .btn-primary {
  box-shadow: 0 4px 16px rgba(240, 118, 35, 0.25), 0 1px 3px rgba(0, 0, 0, 0.1);
}

:root:not(.dark) .btn-primary:hover {
  box-shadow: 0 8px 24px rgba(240, 118, 35, 0.3), 0 2px 4px rgba(0, 0, 0, 0.1);
}

:root:not(.dark) .btn-ghost {
  background: #FFFFFF;
  border-color: rgba(0, 0, 0, 0.1);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

:root:not(.dark) .btn-ghost:hover {
  border-color: rgba(0, 0, 0, 0.15);
  background: #FAFAF8;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
}

/* Badge */
:root:not(.dark) .hero-badge {
  background: #FFFFFF;
  border-color: rgba(0, 0, 0, 0.08);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  color: var(--c-text-muted);
}

/* Conveyor track */
:root:not(.dark) .track-line {
  background: rgba(0, 0, 0, 0.08);
}

:root:not(.dark) .tooth {
  background: rgba(0, 0, 0, 0.08);
}

:root:not(.dark) .zone-waiting { color: #D4580A; border-color: rgba(212, 88, 10, 0.2); background: rgba(240, 118, 35, 0.06); }
:root:not(.dark) .zone-active { color: #0E7490; border-color: rgba(14, 116, 144, 0.2); background: rgba(14, 116, 144, 0.06); }
:root:not(.dark) .zone-done { color: #059669; border-color: rgba(5, 150, 105, 0.2); background: rgba(5, 150, 105, 0.06); }

/* Store icon backgrounds — slightly stronger in light */
:root:not(.dark) .store-icon.pg { background: rgba(51, 103, 145, 0.08); }
:root:not(.dark) .store-icon.sqlite { background: rgba(0, 130, 200, 0.06); color: #0A6FB8; }
:root:not(.dark) .store-icon.mem { background: rgba(5, 150, 105, 0.08); color: #059669; }

/* Feature icon */
:root:not(.dark) .feature-icon {
  background: rgba(240, 118, 35, 0.07);
  color: #D4580A;
}

/* Store tag */
:root:not(.dark) .store-tag {
  background: rgba(212, 88, 10, 0.06);
  color: #D4580A;
  border-color: rgba(212, 88, 10, 0.15);
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
