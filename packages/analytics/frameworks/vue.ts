import { defineComponent, onMounted } from "vue";
import { init, type AnalyticsConfig } from "../src/index.js";

/**
 * `@firstrun/analytics/vue`: the same effect, in Vue's shape.
 *
 * Vue Router pushes through `history.pushState`, so route changes arrive
 * through the tag's own patch and there is nothing to subscribe to. That is why
 * this file is fifteen lines: the interesting part is in `@firstrun/web-tag`,
 * and a wrapper that grew logic of its own would be a second place to look.
 */

export const Analytics = defineComponent({
  name: "FirstrunAnalytics",
  props: {
    sourceKey: { type: String, required: true },
    host: { type: String, required: true },
    autoPage: { type: Boolean, default: true },
    autoOutbound: { type: Boolean, default: true },
    autoVitals: { type: Boolean, default: true },
    autoForms: { type: Boolean, default: true },
    trackLeave: { type: Boolean, default: true },
    // The one that defaults off: see AnalyticsConfig.
    autoErrors: { type: Boolean, default: false },
  },
  setup(props) {
    onMounted(() => init({ ...props } as AnalyticsConfig));
    // Renders nothing. Put it once, in App.vue.
    return () => null;
  },
});

export {
  consent,
  error,
  event,
  flush,
  identify,
  init,
  log,
  navigated,
  page,
  stop,
} from "../src/index.js";
export type { AnalyticsConfig };
