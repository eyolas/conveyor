import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import mediumZoom from 'medium-zoom';
import ConveyorHome from './components/ConveyorHome.vue';
import AnimTerminal from './components/AnimTerminal.vue';
import AnimPipeline from './components/AnimPipeline.vue';
import AnimDashboard from './components/AnimDashboard.vue';
import './style.css';

function setupRuntimeSync() {
  // Only on multi-runtime page
  if (!location.pathname.includes('/concepts/multi-runtime')) return;

  const STORAGE_KEY = 'conveyor-preferred-runtime';
  let syncing = false;

  const groups = document.querySelectorAll('.vp-code-group');
  groups.forEach((group) => {
    const tabs = group.querySelectorAll('.tabs label');
    tabs.forEach((tab) => {
      if (tab.getAttribute('data-sync-ready')) return;
      tab.setAttribute('data-sync-ready', 'true');
      tab.addEventListener('click', () => {
        if (syncing) return;
        const label = tab.textContent?.trim();
        if (label) {
          localStorage.setItem(STORAGE_KEY, label);
          syncAll(label);
        }
      });
    });
  });

  function syncAll(label: string) {
    syncing = true;
    groups.forEach((group) => {
      const tabs = group.querySelectorAll('.tabs label');
      const inputs = group.querySelectorAll<HTMLInputElement>('.tabs input');
      let idx = -1;
      tabs.forEach((t, i) => {
        if (t.textContent?.trim() === label) idx = i;
      });
      if (idx === -1 || inputs[idx]?.checked) return;
      inputs[idx].checked = true;
      tabs.forEach((t, i) => t.classList.toggle('active', i === idx));
    });
    syncing = false;

    // Show/hide Deno-only blocks
    document.querySelectorAll('.runtime-deno-only').forEach((el) => {
      el.classList.toggle('visible', label === 'Deno');
    });
  }

  // Apply saved preference
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) syncAll(saved);
}

function setupMermaidZoom() {
  document.querySelectorAll('.vp-doc .mermaid').forEach((el) => {
    if (el.getAttribute('data-zoom-ready')) return;
    el.setAttribute('data-zoom-ready', 'true');
    el.addEventListener('click', () => {
      el.classList.toggle('fullscreen');
    });
  });
}

export default {
  extends: DefaultTheme,
  enhanceApp({ app, router }) {
    app.component('ConveyorHome', ConveyorHome);
    app.component('AnimTerminal', AnimTerminal);
    app.component('AnimPipeline', AnimPipeline);
    app.component('AnimDashboard', AnimDashboard);

    if (typeof window !== 'undefined') {
      const observer = new MutationObserver(() => {
        setupMermaidZoom();
        setupRuntimeSync();
      });
      router.onAfterRouteChanged = () => {
        setTimeout(() => {
          setupMermaidZoom();
          setupRuntimeSync();
          observer.observe(document.body, { childList: true, subtree: true });
          // Lightbox for dashboard screenshots and other images
          mediumZoom('.vp-doc img:not(.no-zoom)', {
            background: 'rgba(0, 0, 0, 0.85)',
          });
        }, 500);
      };
    }
  },
} satisfies Theme;
