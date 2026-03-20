<template>
  <div class="anim-terminal">
    <div class="term-chrome">
      <span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
      <span class="term-title">conveyor — job events</span>
    </div>
    <div class="term-body" ref="body">
      <div
        v-for="(line, i) in visibleLines"
        :key="i"
        class="term-line"
        :class="line.type"
      >
        <span class="term-time">{{ line.time }}</span>
        <span class="term-badge" :class="line.badge">{{ line.badgeText }}</span>
        <span class="term-msg">{{ line.msg }}</span>
      </div>
      <span class="term-cursor">_</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue';

interface Line {
  time: string;
  badge: string;
  badgeText: string;
  msg: string;
  type: string;
}

const allLines: Line[] = [
  { time: '09:14:01', badge: 'add', badgeText: 'ADD', msg: 'send-email → waiting (delay: 30s)', type: 'info' },
  { time: '09:14:01', badge: 'add', badgeText: 'ADD', msg: 'resize-image → waiting (priority: high)', type: 'info' },
  { time: '09:14:02', badge: 'active', badgeText: 'RUN', msg: 'resize-image picked by worker-1 (concurrency: 3/5)', type: 'active' },
  { time: '09:14:03', badge: 'done', badgeText: 'OK', msg: 'resize-image completed in 1.2s', type: 'success' },
  { time: '09:14:04', badge: 'active', badgeText: 'RUN', msg: 'generate-report picked by worker-2', type: 'active' },
  { time: '09:14:06', badge: 'fail', badgeText: 'ERR', msg: 'generate-report failed — retrying 1/3 (exp backoff: 2s)', type: 'error' },
  { time: '09:14:08', badge: 'active', badgeText: 'RUN', msg: 'generate-report retry picked by worker-1', type: 'active' },
  { time: '09:14:09', badge: 'done', badgeText: 'OK', msg: 'generate-report completed on retry', type: 'success' },
  { time: '09:14:31', badge: 'sched', badgeText: 'DLY', msg: 'send-email delay elapsed → moved to waiting', type: 'info' },
  { time: '09:14:32', badge: 'active', badgeText: 'RUN', msg: 'send-email picked by worker-3', type: 'active' },
  { time: '09:14:33', badge: 'done', badgeText: 'OK', msg: 'send-email completed in 0.8s', type: 'success' },
  { time: '09:14:34', badge: 'rate', badgeText: 'LIM', msg: 'rate limit reached — 10/10 per 60s, pausing workers', type: 'warn' },
  { time: '09:14:35', badge: 'cron', badgeText: 'CRON', msg: 'cleanup-old-jobs scheduled (every 2 hours)', type: 'info' },
  { time: '09:14:36', badge: 'flow', badgeText: 'FLOW', msg: 'deploy-pipeline: 3 children completed → parent active', type: 'active' },
  { time: '09:14:38', badge: 'done', badgeText: 'OK', msg: 'deploy-pipeline completed — all steps done', type: 'success' },
  { time: '09:14:39', badge: 'event', badgeText: 'EVT', msg: 'queue drained — no pending jobs', type: 'info' },
];

const visibleLines = ref<Line[]>([]);
const body = ref<HTMLElement | null>(null);
let timer: ReturnType<typeof setInterval>;
let idx = 0;

onMounted(() => {
  timer = setInterval(() => {
    visibleLines.value.push(allLines[idx % allLines.length]!);
    if (visibleLines.value.length > 12) {
      visibleLines.value.shift();
    }
    idx++;
    nextTick(() => {
      if (body.value) body.value.scrollTop = body.value.scrollHeight;
    });
  }, 1400);
});

onUnmounted(() => clearInterval(timer));
</script>

<style scoped>
.anim-terminal {
  width: 100%;
  max-width: 820px;
  margin: 0 auto;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid var(--c-border, #2D3A4E);
  background: #0D1117;
  box-shadow: 0 24px 80px rgba(0,0,0,0.4);
  font-family: 'Fira Code', monospace;
}

.term-chrome {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: #161B22;
  border-bottom: 1px solid #21262D;
}

.dot { width: 12px; height: 12px; border-radius: 50%; }
.dot.r { background: #FF5F57; }
.dot.y { background: #FFBD2E; }
.dot.g { background: #28CA42; }

.term-title {
  margin-left: 10px;
  font-size: 0.7rem;
  color: #8B949E;
}

.term-body {
  padding: 1rem;
  height: 320px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.term-line {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.72rem;
  line-height: 1.6;
  animation: lineIn 0.3s ease;
  white-space: nowrap;
}

@keyframes lineIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.term-time {
  color: #484F58;
  flex-shrink: 0;
}

.term-badge {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 0.6rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  flex-shrink: 0;
  min-width: 36px;
  text-align: center;
}

.term-badge.add { background: rgba(240, 118, 35, 0.15); color: #F07623; }
.term-badge.active { background: rgba(34, 211, 238, 0.15); color: #22D3EE; }
.term-badge.done { background: rgba(52, 211, 153, 0.15); color: #34D399; }
.term-badge.fail { background: rgba(248, 81, 73, 0.15); color: #F85149; }
.term-badge.rate { background: rgba(255, 189, 46, 0.15); color: #FFBD2E; }
.term-badge.cron { background: rgba(167, 139, 250, 0.15); color: #A78BFA; }
.term-badge.sched { background: rgba(240, 118, 35, 0.15); color: #FF9A52; }
.term-badge.flow { background: rgba(99, 179, 237, 0.15); color: #63B3ED; }
.term-badge.event { background: rgba(148, 163, 184, 0.15); color: #94A3B8; }

.term-msg { color: #C9D1D9; }
.term-line.error .term-msg { color: #F85149; }
.term-line.warn .term-msg { color: #FFBD2E; }
.term-line.success .term-msg { color: #34D399; }

.term-cursor {
  color: #F07623;
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

@media (max-width: 768px) {
  .anim-terminal { display: none; }
}
</style>
