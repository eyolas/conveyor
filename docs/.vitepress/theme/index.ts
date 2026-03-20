import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import ConveyorHome from './components/ConveyorHome.vue';
import AnimTerminal from './components/AnimTerminal.vue';
import AnimPipeline from './components/AnimPipeline.vue';
import AnimDashboard from './components/AnimDashboard.vue';
import './style.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ConveyorHome', ConveyorHome);
    app.component('AnimTerminal', AnimTerminal);
    app.component('AnimPipeline', AnimPipeline);
    app.component('AnimDashboard', AnimDashboard);
  },
} satisfies Theme;
