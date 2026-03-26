import { createApp as createVueApp } from "vue";
import App from "./app.vue";

export function createApp() {
  const app = createVueApp(App);
  return { app };
}

if (!import.meta.env.SSR) {
  const { app } = createApp();
  app.mount("#app");
}
