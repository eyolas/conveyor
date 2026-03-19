import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import ConveyorHome from './components/ConveyorHome.vue';
import './style.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ConveyorHome', ConveyorHome);
  },
} satisfies Theme;
