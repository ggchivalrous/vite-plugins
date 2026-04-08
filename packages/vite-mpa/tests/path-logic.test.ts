import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mpaPlugin, resolveMpaEntries } from "../src";

const testGeneratedDir = resolve(__dirname, ".generated-path-test");

function cleanDirs() {
  if (existsSync(testGeneratedDir)) rmSync(testGeneratedDir, { recursive: true, force: true });
}

describe("vite-plugin-mpa - 路径逻辑验证", () => {
  beforeEach(cleanDirs);
  afterEach(cleanDirs);

  it("rollupOptions.input 的键名应为逻辑路径（不含 .generated），值为物理路径", async () => {
    const plugin = mpaPlugin({
      config: [
        { page: "home", title: "首页", output: "index" },
        { page: "tools/font", title: "字体工具" },
      ],
      generatedDir: testGeneratedDir,
    });

    const rootDir = process.cwd();
    const result = await (plugin as any).config(
      { root: rootDir },
      { command: "build", mode: "production" },
    );

    const input = result?.build?.rollupOptions?.input;
    expect(input).toBeDefined();

    // 验证键名（逻辑路径）
    // 对于 output: "index" 的主入口，键名应为 "index"
    expect(input["index"]).toBeDefined();
    // 对于普通入口，键名应为 "tools/font/index" (因为我们用了 htmlRelativePath.replace('.html', ''))
    expect(input["tools/font/index"]).toBeDefined();

    // 验证值（物理路径）
    expect(input["index"]).toBe(resolve(testGeneratedDir, "index.html"));
    expect(input["tools/font/index"]).toBe(resolve(testGeneratedDir, "tools/font/index.html"));

    // 验证物理文件确实生成了
    expect(existsSync(input["index"])).toBe(true);
    expect(existsSync(input["tools/font/index"])).toBe(true);
  });

  it("生成的 HTML 中的 %ENTRY% 引用应正确联通到物理入口文件", async () => {
    await mpaPlugin({
      config: [
        { page: "home", title: "首页", output: "index" },
        { page: "about", title: "关于" },
      ],
      generatedDir: testGeneratedDir,
    }).config({ root: process.cwd() }, { command: "build", mode: "production" });

    // 1. 验证首页 (output: index)
    const homeHtml = readFileSync(resolve(testGeneratedDir, "index.html"), "utf-8");
    // 首页在 .generated/index.html，引用本应是 home/main.ts（因为 outputPath 是 home）
    // 根据用户逻辑：outputDefaultEntry ? outputPath : "."
    // 如果 page 是 home, outputPath 是 home, 则为 home/main.ts
    expect(homeHtml).toContain('src="home/main.ts"');

    // 2. 验证关于页 (默认)
    const aboutHtml = readFileSync(resolve(testGeneratedDir, "about/index.html"), "utf-8");
    // 关于页在 .generated/about/index.html，引用应为 ./main.ts
    expect(aboutHtml).toContain('src="./main.ts"');
  });

  it("resolveMpaEntries 应返回不含 .generated 的逻辑 HTML 路径，以适配 SSG", async () => {
    const options = {
      config: [
        { page: "home", title: "首页", output: "index" },
        { page: "tools/font", title: "字体工具" },
      ],
      generatedDir: testGeneratedDir,
    };

    const entries = await resolveMpaEntries(options, { command: "build", mode: "production" });

    expect(entries).toHaveLength(2);

    // 验证第一个入口 (home -> index.html)
    const homeEntry = entries.find((e) => e.html === "index.html");
    expect(homeEntry).toBeDefined();
    // entry 物理路径应包含 .generated
    expect(homeEntry?.entry).toContain(".generated-path-test/home/main.ts");

    // 验证第二个入口 (tools/font -> tools/font/index.html)
    const fontEntry = entries.find((e) => e.html === "tools/font/index.html");
    expect(fontEntry).toBeDefined();
    expect(fontEntry?.entry).toContain(".generated-path-test/tools/font/main.ts");
    // html 路径不应包含 .generated
    expect(fontEntry?.html).not.toContain(".generated");
  });
});
