import fs from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "vue/server-renderer";
import { ssgPlugin } from "../src";

const root = path.resolve(import.meta.dirname, "assets-web");
const outputDirs: string[] = [];
const entries = [
  { entry: "./main.ts", html: "index.html" },
  { entry: "/main.ts", html: "about/index.html" },
];

afterEach(async () => {
  await Promise.all(
    outputDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

async function createOutput() {
  const dir = await fs.mkdtemp("/tmp/vite-ssg-assets-");
  outputDirs.push(dir);
  return dir;
}

describe("生产资源", () => {
  it("客户端构建失败时保留原错误，不启动预渲染", async () => {
    const outDir = await createOutput();
    const resolveEntries = vi.fn(() => entries);
    await expect(
      build({
        configFile: false,
        root,
        logLevel: "silent",
        build: { outDir, rollupOptions: { input: path.join(root, "missing.html") } },
        plugins: [ssgPlugin({ entries: resolveEntries, mock: false })],
      }),
    ).rejects.toThrow("missing.html");
    expect(resolveEntries).not.toHaveBeenCalled();
  });

  it.each(["/", "/docs/", "./", "", "https://cdn.example.com/site/"])(
    "默认渲染处理 hash、内联、public 和多页相对路径：base=%j",
    async (base) => {
      const outDir = await createOutput();
      await build({
        configFile: false,
        root,
        base,
        logLevel: "silent",
        build: {
          outDir,
          manifest: false,
          rollupOptions: {
            input: [path.join(root, "index.html"), path.join(root, "about/index.html")],
            output: { assetFileNames: "media/[name]-[hash][extname]" },
          },
        },
        plugins: [ssgPlugin({ entries, mock: false })],
      });

      const imageFile = (await fs.readdir(path.join(outDir, "media"))).find((name) =>
        name.endsWith(".svg"),
      );
      expect(imageFile).toMatch(/^image-.+\.svg$/);
      const clientScripts = await fs.readdir(path.join(outDir, "assets"));
      const clientCode = (
        await Promise.all(
          clientScripts
            .filter((name) => name.endsWith(".js"))
            .map((name) => fs.readFile(path.join(outDir, "assets", name), "utf8")),
        )
      ).join("\n");
      expect(clientCode).toContain(imageFile);

      for (const entry of entries) {
        const html = await fs.readFile(path.join(outDir, entry.html), "utf8");
        const prefix =
          base === "./" || base === "" ? (entry.html === "index.html" ? "./" : "../") : base;
        const imageUrl = `${prefix}media/${imageFile}`;
        expect(html).toContain(`id="hashed" src="${imageUrl}"`);
        expect(html).toContain('id="inline" src="data:image/svg+xml,');
        expect(html).toContain(`id="public" src="${prefix}public.svg"`);
        expect(html).toContain(`srcset="${imageUrl} 1x, ${imageUrl} 2x"`);
        expect(html).toContain(`background-image:url(${imageUrl})`);
        expect(html).not.toMatch(/__SSG_|\/main\.ts|\/image\.svg|\.vite-ssg-/);
      }

      expect(await fs.readFile(path.join(outDir, "public.svg"), "utf8")).toContain("<svg");
      expect((await fs.readdir(root)).filter((name) => name.startsWith(".vite-ssg-"))).toEqual([]);
      await expect(fs.access(path.join(outDir, ".vite/manifest.json"))).rejects.toThrow();
    },
  );

  it("自定义 render 同样接收生产模块，并支持 alias 入口", async () => {
    const outDir = await createOutput();
    await build({
      configFile: false,
      root,
      logLevel: "silent",
      resolve: { alias: { "@entry": path.join(root, "main.ts") } },
      build: { outDir },
      plugins: [
        ssgPlugin({
          mock: false,
          entries: [{ entry: "@entry", html: "index.html" }],
          render: async ({ module, html }) => ({
            html: html.replace(
              '<div id="app"></div>',
              await renderToString(module.createApp().app),
            ),
          }),
        }),
      ],
    });
    const html = await fs.readFile(path.join(outDir, "index.html"), "utf8");
    expect(html).toMatch(/id="hashed" src="\/assets\/image-.+\.svg"/);
    expect(html).not.toContain("data-server-rendered");
  });

  it("渲染失败时构建失败，并清理临时 SSR 产物", async () => {
    const outDir = await createOutput();
    await expect(
      build({
        configFile: false,
        root,
        logLevel: "silent",
        build: { outDir },
        plugins: [
          ssgPlugin({
            mock: false,
            entries: [entries[0]!],
            render: async () => {
              throw new Error("render failed");
            },
          }),
        ],
      }),
    ).rejects.toThrow("预渲染失败");
    expect((await fs.readdir(root)).filter((name) => name.startsWith(".vite-ssg-"))).toEqual([]);
  });
});
