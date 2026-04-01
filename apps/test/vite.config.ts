import { defineConfig } from "vite-plus";
import vue from "@vitejs/plugin-vue";
import { mpaPlugin } from "@ggcv/vite-plugin-mpa";

export default defineConfig({
  plugins: [
    vue(),
    mpaPlugin({
      scanDir: "./src/pages",
    }),
  ],
});
