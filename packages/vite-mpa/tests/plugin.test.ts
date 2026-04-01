import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mpaPlugin, defineMpaConfig } from "../src/index";
import { existsSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Config } from "../src/type";

// 插件 config 钩子的辅助调用函数
async function runPluginConfig(
  config: Config[] | string | undefined,
  extraOptions: Partial<Parameters<typeof mpaPlugin>[0]> = {},
  rootDir = process.cwd(),
) {
  const testGeneratedDir = resolve(__dirname, ".generated-test");
  const testHtmlDir = resolve(__dirname, ".generated-test");

  const plugin = mpaPlugin({
    ...(config !== undefined ? { config } : {}),
    generatedDir: testGeneratedDir,
    ...extraOptions,
  });

  const result = await (plugin as any).config(
    { root: rootDir },
    { command: "build", mode: "production" },
  );

  return { result, testGeneratedDir, testHtmlDir };
}

// ─── 辅助变量 ────────────────────────────────────────────────────────────────

const testGeneratedDir = resolve(__dirname, ".generated-test");

function cleanDirs() {
  if (existsSync(testGeneratedDir)) rmSync(testGeneratedDir, { recursive: true, force: true });
}

// ─── 测试套件 ────────────────────────────────────────────────────────────────
describe("vite-plugin-mpa", () => {
  describe("defineMpaConfig", () => {
    it("对单个对象应包裹成数组", () => {
      const config: Config = { page: "test", title: "测试" };
      expect(defineMpaConfig(config)).toEqual({ __viteMpaPluginConfig: [config] });
    });

    it("对数组输入应原样保留", () => {
      const configs: Config[] = [
        { page: "a", title: "A" },
        { page: "b", title: "B" },
      ];
      expect(defineMpaConfig(configs)).toEqual({ __viteMpaPluginConfig: configs });
    });
  });

  describe("mpaPlugin - 基础功能", () => {
    beforeEach(cleanDirs);
    afterEach(cleanDirs);

    it("直接传入 config 数组时应正确生成文件", async () => {
      const { result } = await runPluginConfig([{ page: "foo", title: "Foo Title" }]);

      const input = result?.build?.rollupOptions?.input;
      expect(input).toBeDefined();
      expect(input["foo"]).toContain(".generated-test");

      // HTML 内容
      const html = readFileSync(input["foo"], "utf-8");
      expect(html).toContain("Foo Title");
      expect(html).toContain(".generated-test/foo/main.ts");

      // 生成的入口文件
      expect(existsSync(resolve(testGeneratedDir, "foo/main.ts"))).toBe(true);
      expect(existsSync(resolve(testGeneratedDir, "foo/app.vue"))).toBe(true);
    });

    it("输出的 HTML 文件路径应为 .generated-test/foo/index.html", async () => {
      const { result } = await runPluginConfig([{ page: "foo", title: "Foo" }]);
      const htmlPath = result?.build?.rollupOptions?.input["foo"].replace(/\\/g, "/");
      expect(htmlPath).toContain(".generated-test/foo/index.html");
    });

    it("使用 output 字段应重定向 HTML 到指定路径", async () => {
      const { result } = await runPluginConfig([{ page: "home", title: "首页", output: "index" }]);

      const input = result?.build?.rollupOptions?.input;
      // 键名为 output 值
      expect(input["home"]).toBeDefined();
      // 路径对应 htmlDir/index.html（根级别）
      expect(input["home"].replace(/\\/g, "/")).toContain(".generated-test/index.html");
    });
  });

  describe("mpaPlugin - metas 功能", () => {
    beforeEach(cleanDirs);
    afterEach(cleanDirs);

    it("应正确生成 meta name/content 标签", async () => {
      const { result } = await runPluginConfig([
        {
          page: "foo",
          title: "Foo",
          metas: [{ name: "description", content: "页面描述" }],
        },
      ]);
      const html = readFileSync(result.build.rollupOptions.input["foo"], "utf-8");
      expect(html).toContain('<meta name="description" content="页面描述" />');
    });

    it("应正确生成 http-equiv meta 标签", async () => {
      const { result } = await runPluginConfig([
        {
          page: "foo",
          title: "Foo",
          metas: [{ "http-equiv": "X-UA-Compatible", content: "IE=edge" }],
        },
      ]);
      const html = readFileSync(result.build.rollupOptions.input["foo"], "utf-8");
      expect(html).toContain('<meta http-equiv="X-UA-Compatible" content="IE=edge" />');
    });

    it("应正确生成多个 meta 标签", async () => {
      const { result } = await runPluginConfig([
        {
          page: "foo",
          title: "Foo",
          metas: [
            { name: "description", content: "描述" },
            { name: "keywords", content: "vite,mpa" },
          ],
        },
      ]);
      const html = readFileSync(result.build.rollupOptions.input["foo"], "utf-8");
      expect(html).toContain('<meta name="description" content="描述" />');
      expect(html).toContain('<meta name="keywords" content="vite,mpa" />');
    });

    it("没有 metas 时不应生成多余换行", async () => {
      const { result } = await runPluginConfig([{ page: "foo", title: "Foo" }]);
      const html = readFileSync(result.build.rollupOptions.input["foo"], "utf-8");
      // %META% 占位符被替换为空字符串，不应留下多余内容
      expect(html).not.toContain("%META%");
    });
  });

  describe("mpaPlugin - favicon 功能", () => {
    beforeEach(cleanDirs);
    afterEach(cleanDirs);

    it("默认 favicon 应为 /{outputPath}.svg", async () => {
      const { result } = await runPluginConfig([{ page: "tools/my-app", title: "App" }]);
      const html = readFileSync(result.build.rollupOptions.input["tools/my-app"], "utf-8");
      expect(html).toContain('href="/tools/my-app.svg"');
    });

    it("自定义 favicon 应覆盖默认值", async () => {
      const { result } = await runPluginConfig([
        { page: "foo", title: "Foo", favicon: "/custom-icon.svg" },
      ]);
      const html = readFileSync(result.build.rollupOptions.input["foo"], "utf-8");
      expect(html).toContain('href="/custom-icon.svg"');
    });
  });

  describe("mpaPlugin - appEntry 多入口", () => {
    beforeEach(cleanDirs);
    afterEach(cleanDirs);

    it("appEntry 为数组时应为每个入口生成独立文件", async () => {
      const { result } = await runPluginConfig([
        { page: "tool", title: "Tool", appEntry: ["index", "admin"] },
      ]);

      const input = result?.build?.rollupOptions?.input;
      expect(input["tool"]).toBeDefined();
      expect(input["tool/admin"]).toBeDefined();

      expect(existsSync(resolve(testGeneratedDir, "tool/main.ts"))).toBe(true);
      expect(existsSync(resolve(testGeneratedDir, "tool/admin/main.ts"))).toBe(true);
      expect(existsSync(resolve(testGeneratedDir, "tool/index.html"))).toBe(true);
      expect(existsSync(resolve(testGeneratedDir, "tool/admin/index.html"))).toBe(true);
    });

    it("appEntry 为数组且配置了 output: 'index' 时，仅默认 index 入口被重定向", async () => {
      const { result } = await runPluginConfig([
        { page: "tool", title: "Tool", appEntry: ["index", "admin"], output: "index" },
      ]);

      const input = result?.build?.rollupOptions?.input;

      // index 入口的 HTML 应该在根目录
      expect(input["tool"]).toBeDefined();
      expect(input["tool"].replace(/\\/g, "/")).toContain(".generated-test/index.html");

      // admin 子入口的 HTML 应该照样走其嵌套目录
      expect(input["tool/admin"]).toBeDefined();
      expect(input["tool/admin"].replace(/\\/g, "/")).toContain(
        ".generated-test/tool/admin/index.html",
      );
    });

    it("appEntry 为单个字符串时应与默认行为一致", async () => {
      const { result: r1 } = await runPluginConfig([{ page: "foo", title: "Foo" }]);
      cleanDirs();
      const { result: r2 } = await runPluginConfig([
        { page: "foo", title: "Foo", appEntry: "index" },
      ]);
      expect(Object.keys(r1.build.rollupOptions.input)).toEqual(
        Object.keys(r2.build.rollupOptions.input),
      );
    });
  });

  describe("mpaPlugin - scanDir 扫描模式", () => {
    const scanTestDir = resolve(__dirname, ".test-scan");

    beforeEach(() => {
      cleanDirs();
      if (existsSync(scanTestDir)) rmSync(scanTestDir, { recursive: true, force: true });
      mkdirSync(scanTestDir, { recursive: true });
      mkdirSync(resolve(scanTestDir, "page1"), { recursive: true });
      mkdirSync(resolve(scanTestDir, "page2"), { recursive: true });

      writeFileSync(
        resolve(scanTestDir, "page1/mpa.config.ts"),
        "export default { page: 'page1', title: 'Page1' };",
      );
      writeFileSync(
        resolve(scanTestDir, "page2/mpa.config.ts"),
        "export default { page: 'page2', title: 'Page2' };",
      );
    });

    afterEach(() => {
      cleanDirs();
      if (existsSync(scanTestDir)) rmSync(scanTestDir, { recursive: true, force: true });
    });

    it("应从 scanDir 扫描并聚合所有配置文件", async () => {
      const plugin = mpaPlugin({
        scanDir: scanTestDir,
        generatedDir: testGeneratedDir,
      });

      const result = await (plugin as any).config(
        { root: process.cwd() },
        { command: "build", mode: "production" },
      );

      const input = result?.build?.rollupOptions?.input;
      expect(input).toBeDefined();
      expect(input["page1"]).toBeDefined();
      expect(input["page2"]).toBeDefined();
    });

    it("config 字符串路径应优先于 scanDir", async () => {
      const plugin = mpaPlugin({
        config: resolve(scanTestDir, "page1/mpa.config.ts"),
        scanDir: scanTestDir,
        generatedDir: testGeneratedDir,
      });

      const result = await (plugin as any).config(
        { root: process.cwd() },
        { command: "build", mode: "production" },
      );

      const input = result?.build?.rollupOptions?.input;
      expect(input["page1"]).toBeDefined();
      expect(input["page2"]).toBeUndefined();
    });

    it("scanDir 不存在时应记录警告并返回 undefined", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const plugin = mpaPlugin({
        scanDir: resolve(__dirname, "__nonexistent__"),
        generatedDir: testGeneratedDir,
      });

      const result = await (plugin as any).config(
        { root: process.cwd() },
        { command: "build", mode: "production" },
      );

      expect(result).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("未找到指定的扫描目录"));

      warnSpy.mockRestore();
    });
  });

  describe("mpaPlugin - config 字符串路径", () => {
    beforeEach(cleanDirs);
    afterEach(cleanDirs);

    it("不存在的配置文件路径应记录警告并返回 undefined", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const plugin = mpaPlugin({
        config: "tests/__nonexistent_config__.ts",
        generatedDir: testGeneratedDir,
      });

      const result = await (plugin as any).config(
        { root: process.cwd() },
        { command: "build", mode: "production" },
      );

      expect(result).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("未找到指定的配置文件"));

      warnSpy.mockRestore();
    });
  });

  describe("mpaPlugin - 空配置", () => {
    beforeEach(cleanDirs);
    afterEach(cleanDirs);

    it("无 config 且无可扫描文件时应警告并返回 undefined", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const plugin = mpaPlugin({
        generatedDir: testGeneratedDir,
      });

      const result = await (plugin as any).config(
        { root: resolve(__dirname, "__nonexistent_root__") },
        { command: "build", mode: "production" },
      );

      expect(result).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("未提供 MPA 页面配置"));

      warnSpy.mockRestore();
    });
  });

  describe("mpaPlugin - 自定义 HTML 模板", () => {
    beforeEach(cleanDirs);
    afterEach(cleanDirs);

    it("应使用自定义模板文件渲染 HTML", async () => {
      // 创建临时自定义模板
      const tmpTemplate = resolve(__dirname, ".tmp-template.html");
      writeFileSync(
        tmpTemplate,
        "<html><title>%TITLE%</title><body>%ENTRY%</body></html>",
        "utf-8",
      );

      try {
        const { result } = await runPluginConfig([{ page: "foo", title: "Custom Template Test" }], {
          template: tmpTemplate,
        });

        const html = readFileSync(result.build.rollupOptions.input["foo"], "utf-8");
        expect(html).toContain("<title>Custom Template Test</title>");
        expect(html).toContain("main.ts");
      } finally {
        if (existsSync(tmpTemplate)) rmSync(tmpTemplate);
      }
    });

    it("自定义模板路径不存在时应回退到内置模板并发出警告", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { result } = await runPluginConfig([{ page: "foo", title: "Fallback" }], {
        template: "tests/__nonexistent_template__.html",
      });

      const html = readFileSync(result.build.rollupOptions.input["foo"], "utf-8");
      // 内置模板包含 DOCTYPE
      expect(html).toContain("<!DOCTYPE html>");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("未找到自定义模板文件"));

      warnSpy.mockRestore();
    });
  });

  describe("mpaPlugin - 合并已有 rollupOptions.input", () => {
    beforeEach(cleanDirs);
    afterEach(cleanDirs);

    it("已有 input 为对象时应合并", async () => {
      const plugin = mpaPlugin({
        config: [{ page: "foo", title: "Foo" }],
        generatedDir: testGeneratedDir,
      });

      const existingInput = { legacy: "/path/to/legacy.html" };
      const result = await (plugin as any).config(
        {
          root: process.cwd(),
          build: { rollupOptions: { input: existingInput } },
        },
        { command: "build", mode: "production" },
      );

      const input = result?.build?.rollupOptions?.input;
      expect(input["legacy"]).toBe("/path/to/legacy.html");
      expect(input["foo"]).toBeDefined();
    });

    it("已有 input 为字符串时应以 _default 键合并", async () => {
      const plugin = mpaPlugin({
        config: [{ page: "foo", title: "Foo" }],
        generatedDir: testGeneratedDir,
      });

      const result = await (plugin as any).config(
        {
          root: process.cwd(),
          build: { rollupOptions: { input: "/path/to/single.html" } },
        },
        { command: "build", mode: "production" },
      );

      const input = result?.build?.rollupOptions?.input;
      expect(input["_default"]).toBe("/path/to/single.html");
      expect(input["foo"]).toBeDefined();
    });

    it("已有 input 为数组时应追加到末尾", async () => {
      const plugin = mpaPlugin({
        config: [{ page: "foo", title: "Foo" }],
        generatedDir: testGeneratedDir,
      });

      const result = await (plugin as any).config(
        {
          root: process.cwd(),
          build: { rollupOptions: { input: ["/path/to/a.html"] } },
        },
        { command: "build", mode: "production" },
      );

      const input = result?.build?.rollupOptions?.input as string[];
      expect(Array.isArray(input)).toBe(true);
      expect(input[0]).toBe("/path/to/a.html");
      expect(input.some((p) => p.includes(".generated-test"))).toBe(true);
    });
  });

  describe("mpaPlugin - 多配置聚合", () => {
    beforeEach(cleanDirs);
    afterEach(cleanDirs);

    it("多个配置应各自生成独立 HTML 和入口文件", async () => {
      const { result } = await runPluginConfig([
        { page: "app-a", title: "App A" },
        { page: "app-b", title: "App B" },
        { page: "app-c", title: "App C" },
      ]);

      const input = result?.build?.rollupOptions?.input;
      expect(Object.keys(input)).toHaveLength(3);
      expect(input["app-a"]).toBeDefined();
      expect(input["app-b"]).toBeDefined();
      expect(input["app-c"]).toBeDefined();
    });
  });
});
