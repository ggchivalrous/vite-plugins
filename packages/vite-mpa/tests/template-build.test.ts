import fs from "node:fs/promises";
import path from "node:path";
import vue from "@vitejs/plugin-vue";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { ssgPlugin } from "../../vite-ssg/src";
import { mpaPlugin, resolveMpaEntries } from "../src";

describe("相对路径模板构建", () => {
  it("全局、页面覆盖和回退模板均支持嵌套页面，并通过客户端和 SSG 构建", async () => {
    const root = await fs.mkdtemp(path.join(import.meta.dirname, ".generated-import-test-"));
    const outDir = path.join(root, "dist");
    const mainTemplate = `import { createSSRApp } from 'vue'
import App from './app.vue'
import '../src/styles/entry'
export function createApp() { return { app: createSSRApp(App) } }
if (!import.meta.env.SSR) createApp().app.mount('#app')`;
    const appTemplate = `<script setup>
import Header from '../src/header.vue'
// @Page
</script>
<template><Header /><Page /></template>`;
    const files = {
      "template/main.ts": mainTemplate,
      "template/app.vue": appTemplate,
      "custom/deep/entry.ts": mainTemplate
        .replace("../src/styles/entry", "../../src/styles/entry")
        .replace("./app.vue", "./shell.vue"),
      "custom/deep/shell.vue": appTemplate.replace("../src/header.vue", "../../src/header.vue"),
      "src/styles/entry.ts": "import './site.css'",
      "src/styles/site.css": ".template-import-test { color: red; }",
      "src/header.vue": "<template><header>Shared header</header></template>",
      "src/page.vue":
        '<template><h1 class="template-import-test">Relative template</h1></template>',
    };

    try {
      for (const [filename, content] of Object.entries(files)) {
        const target = path.join(root, filename);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content);
      }

      const options = {
        mainTemplate: "template/main.ts",
        appTemplate: "template/app.vue",
        config: [
          { page: "home", output: "index", title: "Home" },
          {
            page: "tools/deep/about",
            title: "About",
            mainTemplate: "custom/deep/entry.ts",
            appTemplate: "custom/deep/shell.vue",
          },
          {
            page: "fallback",
            title: "Fallback",
            mainTemplate: "missing.ts",
            appTemplate: "missing.vue",
          },
        ].map((page) => ({ ...page, component: "src/page.vue", favicon: "data:," })),
      };
      const entries = await resolveMpaEntries(
        options,
        { command: "build", mode: "production" },
        root,
      );
      await build({
        root,
        configFile: false,
        logLevel: "silent",
        build: { outDir },
        plugins: [vue(), mpaPlugin(options), ssgPlugin({ entries, mock: false })],
      });

      for (const entry of entries) {
        const html = await fs.readFile(path.join(outDir, entry.html), "utf8");
        expect(html).toContain("Shared header");
        expect(html).toContain("Relative template");
        const main = await fs.readFile(entry.entry, "utf8");
        expect(main).toContain("from './app.vue'");
        const styleImport = /import '([^']+styles\/entry)'/.exec(main)?.[1];
        expect(styleImport).toBeTruthy();
        expect(path.resolve(path.dirname(entry.entry), styleImport!)).toBe(
          path.join(root, "src/styles/entry"),
        );
      }
      const assets = await fs.readdir(path.join(outDir, "assets"));
      const cssFiles = assets.filter((file) => file.endsWith(".css"));
      expect(cssFiles.length).toBeGreaterThan(0);
      const css = (
        await Promise.all(
          cssFiles.map((file) => fs.readFile(path.join(outDir, "assets", file), "utf8")),
        )
      ).join("\n");
      expect(css).toContain(".template-import-test");
      expect(await fs.readFile(path.join(root, "template/main.ts"), "utf8")).toBe(mainTemplate);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
