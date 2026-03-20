import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import ConveyorHome from './components/ConveyorHome.vue';
import AnimTerminal from './components/AnimTerminal.vue';
import AnimPipeline from './components/AnimPipeline.vue';
import AnimDashboard from './components/AnimDashboard.vue';
import './style.css';

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
      const observer = new MutationObserver(() => setupMermaidZoom());
      router.onAfterRouteChanged = () => {
        setTimeout(() => {
          setupMermaidZoom();
          observer.observe(document.body, { childList: true, subtree: true });
        }, 500);
      };
    }
  },
} satisfies Theme;
