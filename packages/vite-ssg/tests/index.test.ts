import { describe, it, expect, vi, afterEach } from "vitest";
import { build } from "vite";
import path from "path";
import fs from "node:fs/promises";
import { ssgPlugin } from "../src";
import type { SSGEntry, SSGRenderContext } from "../src";
import type { Plugin, ResolvedConfig } from "vite";
import vue from "@vitejs/plugin-vue";

/**
 * 创建最小化的 ResolvedConfig mock
 */
function createMockResolvedConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    root: "/mock/project",
    build: { outDir: "dist", ...overrides.build },
    resolve: { alias: [], ...overrides.resolve },
    configFile: "/mock/project/vite.config.ts",
    ...overrides,
  } as unknown as ResolvedConfig;
}

/**
 * 调用 configResolved 钩子
 */
function callConfigResolved(plugin: Plugin, config: ResolvedConfig) {
  if (typeof plugin.configResolved === "function") {
    (plugin.configResolved as Function)(config);
  }
}

/**
 * 调用 closeBundle handler
 */
async function callCloseBundle(plugin: Plugin) {
  const hook = plugin.closeBundle;
  if (typeof hook === "object" && hook !== null && "handler" in hook) {
    await (hook as any).handler();
  } else if (typeof hook === "function") {
    await (hook as Function)();
  }
}

/**
 * 创建临时输出目录路径
 */
function tmpOutDir(name: string) {
  return path.resolve("/tmp", `ssg-test-${name}-${Date.now()}`);
}

describe("@ggcv/vite-plugin-ssg", () => {
  describe("插件基础属性", () => {
    it("应当返回正确的 name", () => {
      const plugin = ssgPlugin({ entries: [] });
      expect(plugin.name).toBe("vite-plugin-ssg");
    });

    it("apply 应为 'build'（仅在构建阶段生效）", () => {
      const plugin = ssgPlugin({ entries: [] });
      expect(plugin.apply).toBe("build");
    });

    it("enforce 应为 'post'（在最后执行）", () => {
      const plugin = ssgPlugin({ entries: [] });
      expect(plugin.enforce).toBe("post");
    });

    it("closeBundle 应配置为 sequential + order: pre", () => {
      const plugin = ssgPlugin({ entries: [] });
      const hook = plugin.closeBundle as any;
      expect(hook.sequential).toBe(true);
      expect(hook.order).toBe("pre");
      expect(typeof hook.handler).toBe("function");
    });
  });

  describe("enabled 选项", () => {
    it("enabled: false 时应跳过预渲染", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const plugin = ssgPlugin({
        entries: [{ entry: "./main.ts", html: "index.html" }],
        enabled: false,
      });
      callConfigResolved(plugin, createMockResolvedConfig());
      await expect(callCloseBundle(plugin)).resolves.not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("已禁用"));
      consoleSpy.mockRestore();
    });
  });

  describe("空 entries", () => {
    it("entries 为空数组时应输出警告并跳过", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const plugin = ssgPlugin({ entries: [] });
      callConfigResolved(plugin, createMockResolvedConfig());
      await callCloseBundle(plugin);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("未配置任何入口"));
      warnSpy.mockRestore();
    });

    it("entries 为返回空数组的函数时应输出警告并跳过", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const plugin = ssgPlugin({ entries: () => [] });
      callConfigResolved(plugin, createMockResolvedConfig());
      await callCloseBundle(plugin);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("未配置任何入口"));
      warnSpy.mockRestore();
    });
  });

  describe("entries 函数式入口", () => {
    it("支持异步函数作为 entries", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const entriesFn = vi.fn(async () => [] as SSGEntry[]);
      const plugin = ssgPlugin({ entries: entriesFn });
      callConfigResolved(plugin, createMockResolvedConfig());
      await callCloseBundle(plugin);
      expect(entriesFn).toHaveBeenCalledOnce();
      warnSpy.mockRestore();
    });
  });

  describe("logPrefix 参数", () => {
    it("logPrefix 默认为 'SSG'", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const plugin = ssgPlugin({ entries: [], enabled: false });
      callConfigResolved(plugin, createMockResolvedConfig());
      await callCloseBundle(plugin);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[SSG]"));
      consoleSpy.mockRestore();
    });

    it("logPrefix 可自定义", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const plugin = ssgPlugin({ entries: [], enabled: false, logPrefix: "MY-SSG" });
      callConfigResolved(plugin, createMockResolvedConfig());
      await callCloseBundle(plugin);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[MY-SSG]"));
      consoleSpy.mockRestore();
    });
  });

  describe("SSG 构建效果验证", () => {
    const cleanupDirs: string[] = [];

    afterEach(async () => {
      for (const dir of cleanupDirs) {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
      cleanupDirs.length = 0;
    });

    it("默认 Vue SSR 渲染：应将 Vue 组件渲染为静态 HTML 写入产物", async () => {
      const fixturePath = path.resolve(__dirname, "./simple-web");
      const outDir = tmpOutDir("vue-ssr");
      cleanupDirs.push(outDir);

      await build({
        root: fixturePath,
        logLevel: "silent",
        build: {
          outDir,
          write: true,
          minify: false,
          ssr: false,
        },
        plugins: [
          vue(),
          ssgPlugin({
            entries: [{ entry: "./main.ts", html: "index.html" }],
            ssrViteConfig: { plugins: [vue()] },
          }),
        ],
      });

      const html = await fs.readFile(path.join(outDir, "index.html"), "utf-8");

      // ✅ Vue 组件的内容应被渲染到 HTML 中
      expect(html).toContain("Simple Web");

      // ✅ 默认的 data-server-rendered 属性应被注入
      expect(html).toContain('data-server-rendered="true"');

      // ✅ 原始的空 <div id="app"></div> 占位符应被替换掉
      expect(html).not.toContain('<div id="app"></div>');

      // ✅ app 容器仍然存在（只是包含了渲染内容）
      expect(html).toContain('id="app"');
    });

    it("自定义 render 函数：应使用用户提供的渲染逻辑替换 HTML", async () => {
      const fixturePath = path.resolve(__dirname, "./custom-render-web");
      const outDir = tmpOutDir("custom-render");
      cleanupDirs.push(outDir);

      await build({
        root: fixturePath,
        logLevel: "silent",
        build: {
          outDir,
          write: true,
          minify: false,
          ssr: false,
        },
        plugins: [
          vue(),
          ssgPlugin({
            entries: [{ entry: "./main.ts", html: "index.html" }],
            mock: false,
            render: async (ctx: SSGRenderContext) => {
              // 调用入口模块的 getContent 获取内容
              const content = ctx.module.getContent();
              return {
                html: ctx.html.replace('<div id="app"></div>', `<div id="app">${content}</div>`),
              };
            },
          }),
        ],
      });

      const html = await fs.readFile(path.join(outDir, "index.html"), "utf-8");

      // ✅ 自定义渲染内容应出现在 HTML 中
      expect(html).toContain("Custom SSG Content Here");

      // ✅ 使用自定义 render 时不应有默认的 data-server-rendered
      expect(html).not.toContain("data-server-rendered");
    });

    it("自定义 render 函数：context 应包含完整的 module、entry、html", async () => {
      const fixturePath = path.resolve(__dirname, "./custom-render-web");
      const outDir = tmpOutDir("render-ctx");
      cleanupDirs.push(outDir);

      let capturedContext: SSGRenderContext | null = null;

      await build({
        root: fixturePath,
        logLevel: "silent",
        build: {
          outDir,
          write: true,
          minify: false,
          ssr: false,
        },
        plugins: [
          vue(),
          ssgPlugin({
            entries: [{ entry: "./main.ts", html: "index.html" }],
            mock: false,
            render: async (ctx: SSGRenderContext) => {
              capturedContext = ctx;
              return { html: ctx.html };
            },
          }),
        ],
      });

      // ✅ context.module 应包含入口模块的导出
      expect(capturedContext).not.toBeNull();
      expect(capturedContext!.module).toBeDefined();
      expect(typeof capturedContext!.module.getContent).toBe("function");

      // ✅ context.entry 应包含当前入口配置
      expect(capturedContext!.entry).toEqual({
        entry: "./main.ts",
        html: "index.html",
      });

      // ✅ context.html 应包含构建后的 HTML 内容
      expect(capturedContext!.html).toContain("<!doctype html>");
      expect(capturedContext!.html).toContain('<div id="app"></div>');
    });

    it("enabled: false 时不应执行任何渲染（产物 HTML 保持原样）", async () => {
      const fixturePath = path.resolve(__dirname, "./simple-web");
      const outDir = tmpOutDir("disabled");
      cleanupDirs.push(outDir);

      await build({
        root: fixturePath,
        logLevel: "silent",
        build: {
          outDir,
          write: true,
          minify: false,
          ssr: false,
        },
        plugins: [
          vue(),
          ssgPlugin({
            entries: [{ entry: "./main.ts", html: "index.html" }],
            enabled: false,
          }),
        ],
      });

      const html = await fs.readFile(path.join(outDir, "index.html"), "utf-8");

      // ✅ 禁用时原始占位符应保持不变
      expect(html).toContain('<div id="app"></div>');

      // ✅ 不应有 SSR 渲染的痕迹
      expect(html).not.toContain("data-server-rendered");

      // ✅ 不应有 Vue 组件渲染的内容（<h1> 只存在于 JS 模块中）
      expect(html).not.toContain("<h1>");
    });

    it("entries 为函数时应正确解析并执行渲染", async () => {
      const fixturePath = path.resolve(__dirname, "./simple-web");
      const outDir = tmpOutDir("fn-entries");
      cleanupDirs.push(outDir);

      const entriesFn = vi.fn(() => [{ entry: "./main.ts", html: "index.html" }]);

      await build({
        root: fixturePath,
        logLevel: "silent",
        build: {
          outDir,
          write: true,
          minify: false,
          ssr: false,
        },
        plugins: [
          vue(),
          ssgPlugin({
            entries: entriesFn,
            ssrViteConfig: { plugins: [vue()] },
          }),
        ],
      });

      // ✅ entries 函数应被调用
      expect(entriesFn).toHaveBeenCalledOnce();

      const html = await fs.readFile(path.join(outDir, "index.html"), "utf-8");

      // ✅ 渲染结果应与静态 entries 一致
      expect(html).toContain("Simple Web");
      expect(html).toContain('data-server-rendered="true"');
    });
  });
});
