<template>
  <div class="anim-dashboard">
    <!-- Top stats row -->
    <div class="dash-stats">
      <div class="stat" v-for="s in stats" :key="s.label">
        <div class="stat-value" :class="s.color">{{ s.value }}</div>
        <div class="stat-label">{{ s.label }}</div>
      </div>
    </div>

    <!-- Main area: workers + event feed -->
    <div class="dash-main">
      <!-- Workers panel -->
      <div class="dash-workers">
        <div class="panel-header">Workers</div>
        <div class="worker-list">
          <div v-for="w in workers" :key="w.id" class="worker-row" :class="{ busy: w.job }">
            <span class="worker-name">{{ w.id }}</span>
            <span v-if="w.job" class="worker-job">{{ w.job }}</span>
            <span v-else class="worker-idle">idle</span>
            <span v-if="w.job" class="worker-spinner"></span>
          </div>
        </div>
      </div>

      <!-- Event feed -->
      <div class="dash-feed">
        <div class="panel-header">Events</div>
        <div class="feed-list" ref="feedEl">
          <div
            v-for="(evt, i) in events"
            :key="i"
            class="feed-row"
            :class="evt.type"
          >
            <span class="feed-icon">{{ evt.icon }}</span>
            <span class="feed-text">{{ evt.text }}</span>
            <span class="feed-ago">{{ evt.ago }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom: queue bar -->
    <div class="dash-queue">
      <div class="queue-bar">
        <div class="queue-seg waiting" :style="{ width: queueBar.waiting + '%' }"></div>
        <div class="queue-seg active" :style="{ width: queueBar.active + '%' }"></div>
        <div class="queue-seg completed" :style="{ width: queueBar.completed + '%' }"></div>
        <div class="queue-seg failed" :style="{ width: queueBar.failed + '%' }"></div>
      </div>
      <div class="queue-legend">
        <span class="leg waiting">waiting {{ queueBar.waiting }}%</span>
        <span class="leg active">active {{ queueBar.active }}%</span>
        <span class="leg completed">completed {{ queueBar.completed }}%</span>
        <span class="leg failed">failed {{ queueBar.failed }}%</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, nextTick } from 'vue';

const stats = reactive([
  { label: 'Jobs/min', value: '0', color: 'brand' },
  { label: 'Active', value: '0', color: 'cyan' },
  { label: 'Completed', value: '0', color: 'green' },
  { label: 'Failed', value: '0', color: 'red' },
]);

const workers = reactive([
  { id: 'worker-1', job: null as string | null },
  { id: 'worker-2', job: null as string | null },
  { id: 'worker-3', job: null as string | null },
]);

interface Event {
  icon: string;
  text: string;
  ago: string;
  type: string;
}

const events = ref<Event[]>([]);
const feedEl = ref<HTMLElement | null>(null);

const queueBar = reactive({ waiting: 40, active: 20, completed: 35, failed: 5 });

let completed = 0;
let failed = 0;
let timer: ReturnType<typeof setInterval>;
let step = 0;

const jobNames = ['send-email', 'resize-img', 'gen-pdf', 'deploy', 'sync-data', 'cleanup', 'notify-slack', 'process-payment'];

function addEvent(icon: string, text: string, type: string) {
  events.value.push({ icon, text, ago: 'now', type });
  if (events.value.length > 8) events.value.shift();
  nextTick(() => { if (feedEl.value) feedEl.value.scrollTop = feedEl.value.scrollHeight; });
}

function randomJob() {
  return jobNames[Math.floor(Math.random() * jobNames.length)]!;
}

const scenarios = [
  () => {
    const job = randomJob();
    workers[0]!.job = job;
    stats[1]!.value = '1';
    addEvent('>', `${job} picked by worker-1`, 'active');
    queueBar.waiting = 35; queueBar.active = 25;
  },
  () => {
    const job = randomJob();
    workers[1]!.job = job;
    stats[1]!.value = '2';
    addEvent('>', `${job} picked by worker-2`, 'active');
    queueBar.active = 30;
  },
  () => {
    const done = workers[0]!.job;
    workers[0]!.job = null;
    completed++;
    stats[2]!.value = String(completed);
    stats[1]!.value = '1';
    stats[0]!.value = String(Math.floor(completed * 4.2));
    addEvent('✓', `${done} completed (1.2s)`, 'success');
    queueBar.active = 20; queueBar.completed = 40;
  },
  () => {
    const failJob = workers[1]!.job;
    workers[1]!.job = null;
    failed++;
    stats[3]!.value = String(failed);
    stats[1]!.value = '0';
    addEvent('✗', `${failJob} failed — retry 1/3`, 'error');
    queueBar.active = 15; queueBar.failed = 8;
  },
  () => {
    const job = randomJob();
    workers[2]!.job = job;
    stats[1]!.value = '1';
    addEvent('⏱', `${job} delay elapsed → active`, 'info');
    queueBar.waiting = 25; queueBar.active = 25;
  },
  () => {
    const done = workers[2]!.job;
    workers[2]!.job = null;
    completed++;
    stats[2]!.value = String(completed);
    stats[0]!.value = String(Math.floor(completed * 4.2));
    stats[1]!.value = '0';
    addEvent('✓', `${done} completed (0.4s)`, 'success');
    queueBar.completed = 50; queueBar.active = 10;
  },
  () => {
    addEvent('⚡', 'rate limit 10/10 — pausing 5s', 'warn');
    queueBar.waiting = 40; queueBar.active = 5;
  },
  () => {
    const job = randomJob();
    workers[0]!.job = job;
    workers[1]!.job = randomJob();
    stats[1]!.value = '2';
    addEvent('⑂', `flow: ${job} + 2 children started`, 'info');
    queueBar.active = 30; queueBar.waiting = 20;
  },
  () => {
    workers.forEach(w => w.job = null);
    completed += 3;
    stats[2]!.value = String(completed);
    stats[1]!.value = '0';
    stats[0]!.value = String(Math.floor(completed * 4.2));
    addEvent('✓', 'flow completed — all children done', 'success');
    addEvent('◎', 'queue drained', 'info');
    queueBar.waiting = 0; queueBar.active = 0; queueBar.completed = 92; queueBar.failed = 8;
  },
  () => {
    // Reset
    completed = 0; failed = 0;
    stats[0]!.value = '0'; stats[1]!.value = '0'; stats[2]!.value = '0'; stats[3]!.value = '0';
    workers.forEach(w => w.job = null);
    events.value = [];
    queueBar.waiting = 40; queueBar.active = 20; queueBar.completed = 35; queueBar.failed = 5;
    step = -1;
  },
];

onMounted(() => {
  timer = setInterval(() => {
    scenarios[step % scenarios.length]!();
    step++;
  }, 1800);
});

onUnmounted(() => clearInterval(timer));
</script>

<style scoped>
.anim-dashboard {
  width: 100%;
  max-width: 820px;
  margin: 0 auto;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid var(--c-border, #2D3A4E);
  background: #0D1117;
  box-shadow: 0 24px 80px rgba(0,0,0,0.4);
  font-family: 'Fira Code', monospace;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* ─── Stats Row ───────────────── */
.dash-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.stat {
  text-align: center;
  padding: 12px 8px;
  border-radius: 8px;
  background: #161B22;
  border: 1px solid #21262D;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 700;
  transition: all 0.3s ease;
}

.stat-value.brand { color: #F07623; }
.stat-value.cyan { color: #22D3EE; }
.stat-value.green { color: #34D399; }
.stat-value.red { color: #F85149; }

.stat-label {
  font-size: 0.6rem;
  color: #484F58;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-top: 4px;
}

/* ─── Main Area ───────────────── */
.dash-main {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 10px;
}

.panel-header {
  font-size: 0.6rem;
  color: #484F58;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding-bottom: 8px;
  border-bottom: 1px solid #21262D;
  margin-bottom: 8px;
}

/* Workers */
.dash-workers {
  padding: 12px;
  border-radius: 8px;
  background: #161B22;
  border: 1px solid #21262D;
}

.worker-list { display: flex; flex-direction: column; gap: 6px; }

.worker-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 0.65rem;
  background: #0D1117;
  border: 1px solid #21262D;
  transition: all 0.3s ease;
}

.worker-row.busy {
  border-color: rgba(34, 211, 238, 0.2);
  background: rgba(34, 211, 238, 0.05);
}

.worker-name { color: #8B949E; flex-shrink: 0; }
.worker-job { color: #22D3EE; flex: 1; overflow: hidden; text-overflow: ellipsis; }
.worker-idle { color: #30363D; font-style: italic; }

.worker-spinner {
  width: 8px;
  height: 8px;
  border: 1.5px solid rgba(34, 211, 238, 0.3);
  border-top-color: #22D3EE;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  flex-shrink: 0;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* Feed */
.dash-feed {
  padding: 12px;
  border-radius: 8px;
  background: #161B22;
  border: 1px solid #21262D;
}

.feed-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 160px;
  overflow: hidden;
}

.feed-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.65rem;
  padding: 4px 6px;
  border-radius: 4px;
  animation: feedIn 0.3s ease;
}

.feed-row.active { color: #22D3EE; }
.feed-row.success { color: #34D399; }
.feed-row.error { color: #F85149; }
.feed-row.warn { color: #FFBD2E; }
.feed-row.info { color: #8B949E; }

@keyframes feedIn {
  from { opacity: 0; transform: translateX(-8px); }
  to { opacity: 1; transform: translateX(0); }
}

.feed-icon { flex-shrink: 0; width: 14px; text-align: center; }
.feed-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.feed-ago { color: #30363D; flex-shrink: 0; }

/* ─── Queue Bar ───────────────── */
.dash-queue {}

.queue-bar {
  display: flex;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  background: #161B22;
}

.queue-seg {
  transition: width 0.6s ease;
}

.queue-seg.waiting { background: #F07623; }
.queue-seg.active { background: #22D3EE; }
.queue-seg.completed { background: #34D399; }
.queue-seg.failed { background: #F85149; }

.queue-legend {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-top: 8px;
}

.leg {
  font-size: 0.55rem;
  color: #484F58;
  display: flex;
  align-items: center;
  gap: 4px;
}

.leg::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 2px;
}

.leg.waiting::before { background: #F07623; }
.leg.active::before { background: #22D3EE; }
.leg.completed::before { background: #34D399; }
.leg.failed::before { background: #F85149; }

@media (max-width: 768px) {
  .anim-dashboard { display: none; }
}
</style>
