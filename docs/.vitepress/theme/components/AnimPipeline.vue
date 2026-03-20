<template>
  <div class="anim-pipeline">
    <!-- Stages -->
    <div class="pipeline-track">
      <div class="stage" v-for="stage in stages" :key="stage.id" :class="stage.id">
        <div class="stage-label">{{ stage.label }}</div>
        <div class="stage-box">
          <div
            v-for="job in stage.jobs"
            :key="job.id"
            class="pip-job"
            :class="[job.status, { flash: job.flash }]"
          >
            <span class="job-name">{{ job.name }}</span>
            <span v-if="job.tag" class="job-tag" :class="job.tagType">{{ job.tag }}</span>
          </div>
          <div v-if="stage.jobs.length === 0" class="stage-empty">—</div>
        </div>
        <div class="stage-count">{{ stage.jobs.length }}</div>
      </div>
    </div>

    <!-- Connectors -->
    <div class="pipeline-arrows">
      <svg class="arrow-svg" viewBox="0 0 600 40" preserveAspectRatio="none">
        <defs>
          <marker id="ah" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <path d="M0 0L8 3L0 6" fill="#2D3A4E" />
          </marker>
        </defs>
        <line x1="120" y1="20" x2="178" y2="20" stroke="#2D3A4E" stroke-width="2" marker-end="url(#ah)" />
        <line x1="300" y1="20" x2="358" y2="20" stroke="#2D3A4E" stroke-width="2" marker-end="url(#ah)" />
        <line x1="480" y1="20" x2="538" y2="20" stroke="#2D3A4E" stroke-width="2" marker-end="url(#ah)" />
      </svg>
    </div>

    <!-- Feature labels -->
    <div class="pipeline-features">
      <div class="pip-feature" v-for="feat in activeFeatures" :key="feat" :class="{ show: feat }">
        <span class="feat-dot"></span>
        {{ feat }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue';

interface Job {
  id: number;
  name: string;
  status: string;
  tag?: string;
  tagType?: string;
  flash?: boolean;
}

interface Stage {
  id: string;
  label: string;
  jobs: Job[];
}

const stages = reactive<Stage[]>([
  { id: 'delayed', label: 'Delayed', jobs: [] },
  { id: 'waiting', label: 'Waiting', jobs: [] },
  { id: 'active', label: 'Active', jobs: [] },
  { id: 'completed', label: 'Completed', jobs: [] },
]);

const activeFeatures = ref<string[]>([]);
let timer: ReturnType<typeof setInterval>;
let jobId = 0;
let step = 0;

const scenarios = [
  // Step 0: Add delayed job
  () => {
    stages[0]!.jobs.push({ id: ++jobId, name: 'send-email', status: 'delayed', tag: 'delay: 30s', tagType: 'delay' });
    activeFeatures.value = ['Scheduling — delayed job added'];
  },
  // Step 1: Add normal jobs
  () => {
    stages[1]!.jobs.push({ id: ++jobId, name: 'resize-img', status: 'waiting', tag: 'priority: high', tagType: 'priority' });
    stages[1]!.jobs.push({ id: ++jobId, name: 'gen-report', status: 'waiting' });
    activeFeatures.value = ['Priority — high priority job queued first'];
  },
  // Step 2: Worker picks high priority
  () => {
    const job = stages[1]!.jobs.shift();
    if (job) { job.status = 'active'; job.flash = true; stages[2]!.jobs.push(job); }
    activeFeatures.value = ['Concurrency — worker-1 picks resize-img'];
  },
  // Step 3: Complete + pick next
  () => {
    const done = stages[2]!.jobs.shift();
    if (done) { done.status = 'done'; done.tag = '1.2s'; done.tagType = 'time'; stages[3]!.jobs.push(done); }
    const next = stages[1]!.jobs.shift();
    if (next) { next.status = 'active'; next.flash = true; stages[2]!.jobs.push(next); }
    activeFeatures.value = ['Concurrency — completed, next job picked'];
  },
  // Step 4: Fail + retry
  () => {
    const fail = stages[2]!.jobs.shift();
    if (fail) { fail.status = 'retry'; fail.tag = 'retry 1/3'; fail.tagType = 'retry'; stages[1]!.jobs.push(fail); }
    activeFeatures.value = ['Retry — exponential backoff, attempt 1/3'];
  },
  // Step 5: Retry succeeds
  () => {
    const retry = stages[1]!.jobs.shift();
    if (retry) { retry.status = 'active'; retry.flash = true; stages[2]!.jobs.push(retry); }
    activeFeatures.value = ['Retry — worker picks retry job'];
  },
  // Step 6: Retry completes + delayed moves
  () => {
    const done = stages[2]!.jobs.shift();
    if (done) { done.status = 'done'; done.tag = '0.9s'; done.tagType = 'time'; stages[3]!.jobs.push(done); }
    const delayed = stages[0]!.jobs.shift();
    if (delayed) { delayed.status = 'waiting'; delayed.tag = undefined; stages[1]!.jobs.push(delayed); }
    activeFeatures.value = ['Scheduling — delay elapsed, job moved to waiting'];
  },
  // Step 7: Process delayed + add flow
  () => {
    const job = stages[1]!.jobs.shift();
    if (job) { job.status = 'active'; job.flash = true; stages[2]!.jobs.push(job); }
    stages[0]!.jobs.push({ id: ++jobId, name: 'deploy', status: 'delayed', tag: 'flow: 3 children', tagType: 'flow' });
    activeFeatures.value = ['Flows — parent job waits for 3 children'];
  },
  // Step 8: Complete + rate limit
  () => {
    const done = stages[2]!.jobs.shift();
    if (done) { done.status = 'done'; done.tag = '0.8s'; done.tagType = 'time'; stages[3]!.jobs.push(done); }
    activeFeatures.value = ['Rate Limiting — 10/10 per 60s, pausing'];
  },
  // Step 9: Reset
  () => {
    stages.forEach(s => s.jobs.splice(0));
    activeFeatures.value = ['Queue drained — cycle complete'];
    step = -1;
  },
];

onMounted(() => {
  timer = setInterval(() => {
    scenarios[step % scenarios.length]!();
    step++;
  }, 2200);
});

onUnmounted(() => clearInterval(timer));
</script>

<style scoped>
.anim-pipeline {
  width: 100%;
  max-width: 820px;
  margin: 0 auto;
  padding: 2rem;
  border-radius: 14px;
  border: 1px solid var(--c-border, #2D3A4E);
  background: #0D1117;
  box-shadow: 0 24px 80px rgba(0,0,0,0.4);
}

.pipeline-track {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  position: relative;
}

.stage-label {
  font-family: 'Fira Code', monospace;
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-align: center;
  margin-bottom: 8px;
}

.delayed .stage-label { color: #FF9A52; }
.waiting .stage-label { color: #F07623; }
.active .stage-label { color: #22D3EE; }
.completed .stage-label { color: #34D399; }

.stage-box {
  min-height: 140px;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid #21262D;
  background: #161B22;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stage-count {
  text-align: center;
  font-family: 'Fira Code', monospace;
  font-size: 0.6rem;
  color: #484F58;
  margin-top: 6px;
}

.pip-job {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 6px;
  font-family: 'Fira Code', monospace;
  font-size: 0.65rem;
  animation: jobIn 0.35s ease;
  border: 1px solid transparent;
}

.pip-job.delayed { background: rgba(255, 154, 82, 0.1); border-color: rgba(255, 154, 82, 0.2); color: #FF9A52; }
.pip-job.waiting { background: rgba(240, 118, 35, 0.1); border-color: rgba(240, 118, 35, 0.2); color: #F07623; }
.pip-job.active { background: rgba(34, 211, 238, 0.1); border-color: rgba(34, 211, 238, 0.2); color: #22D3EE; }
.pip-job.done { background: rgba(52, 211, 153, 0.1); border-color: rgba(52, 211, 153, 0.2); color: #34D399; }
.pip-job.retry { background: rgba(248, 81, 73, 0.1); border-color: rgba(248, 81, 73, 0.2); color: #F85149; }

.pip-job.flash {
  animation: jobFlash 0.5s ease;
}

@keyframes jobIn {
  from { opacity: 0; transform: scale(0.9); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes jobFlash {
  0% { opacity: 0; transform: scale(0.9); box-shadow: 0 0 0 rgba(34, 211, 238, 0); }
  50% { box-shadow: 0 0 16px rgba(34, 211, 238, 0.3); }
  100% { opacity: 1; transform: scale(1); box-shadow: 0 0 0 rgba(34, 211, 238, 0); }
}

.job-name { font-weight: 500; }

.job-tag {
  font-size: 0.55rem;
  padding: 1px 5px;
  border-radius: 3px;
  white-space: nowrap;
}

.job-tag.delay { background: rgba(255, 154, 82, 0.2); color: #FF9A52; }
.job-tag.priority { background: rgba(240, 118, 35, 0.2); color: #F07623; }
.job-tag.time { background: rgba(52, 211, 153, 0.2); color: #34D399; }
.job-tag.retry { background: rgba(248, 81, 73, 0.2); color: #F85149; }
.job-tag.flow { background: rgba(99, 179, 237, 0.2); color: #63B3ED; }

.stage-empty {
  color: #21262D;
  text-align: center;
  padding: 2rem 0;
  font-size: 1.2rem;
}

.pipeline-arrows {
  display: none; /* hidden for now, arrows between columns are implied */
}

.pipeline-features {
  margin-top: 1.25rem;
  min-height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.pip-feature {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Fira Code', monospace;
  font-size: 0.7rem;
  color: #8B949E;
  animation: featIn 0.3s ease;
  padding: 4px 12px;
  border-radius: 100px;
  background: rgba(240, 118, 35, 0.08);
  border: 1px solid rgba(240, 118, 35, 0.15);
  color: #FF9A52;
}

.feat-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #F07623;
  animation: pulse 2s ease infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

@keyframes featIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 768px) {
  .anim-pipeline { display: none; }
}
</style>
