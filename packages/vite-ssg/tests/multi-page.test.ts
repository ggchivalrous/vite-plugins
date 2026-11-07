import fs from "node:fs/promises";
import path from "node:path";
import vue from "@vitejs/plugin-vue";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { mpaPlugin, resolveMpaEntries } from "../../vite-mpa/src";
import { ssgPlugin } from "../src";

describe("MPA 与 SSG 联调", () => {
  it.each(["/", "./"])("最终 HTML 和资源路径一致：base=%s", async (base) => {
    const root = await fs.mkdtemp(path.join(import.meta.dirname, ".generated-ssg-test-"));
    const outDir = path.join(root, "dist");
    const options = {
      config: [
        { page: "home", output: "index", title: "Home" },
        { page: "tools/about", title: "About" },
      ].map((page) => ({
        ...page,
        favicon: "data:,",
        component: path.resolve(import.meta.dirname, "assets-web/page.vue"),
      })),
    };

    try {
      const entries = await resolveMpaEntries(
        options,
        { command: "build", mode: "production" },
        root,
      );
      await build({
        configFile: false,
        root,
        base,
        logLevel: "silent",
        build: { outDir },
        plugins: [vue(), mpaPlugin(options), ssgPlugin({ entries, mock: false })],
      });

      for (const entry of entries) {
        const html = await fs.readFile(path.join(outDir, entry.html), "utf8");
        expect(html).toContain("<h1>MPA SSG</h1>");
        const image = /<img src="([^"]+)"/.exec(html)?.[1];
        expect(image).toBeTruthy();
        const imagePath = image!.startsWith("/")
          ? path.join(outDir, image!.slice(1))
          : path.resolve(outDir, path.dirname(entry.html), image!);
        expect(await fs.readFile(imagePath, "utf8")).toContain("<svg");
      }
      expect((await fs.readdir(root)).filter((name) => name.startsWith(".vite-ssg-"))).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
