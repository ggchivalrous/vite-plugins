import { defineConfig } from "vite-plus/pack";

export default defineConfig({
  dts: {
    tsgo: true,
  },
  exports: true,
  deps: {
    neverBundle: ["vite", "happy-dom", "vue/server-renderer"],
  },
});
