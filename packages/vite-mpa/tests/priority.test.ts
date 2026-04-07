import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mpaPlugin } from "../src/index";
import { existsSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Config } from "../src/type";

describe("vite-plugin-mpa - 模板优先级", () => {
  const testGeneratedDir = resolve(__dirname, ".generated-priority-test");
  const testTemplatesDir = resolve(__dirname, ".templates-priority");
  const rootDir = __dirname;

  function cleanDirs() {
    if (existsSync(testGeneratedDir)) rmSync(testGeneratedDir, { recursive: true, force: true });
    if (existsSync(testTemplatesDir)) rmSync(testTemplatesDir, { recursive: true, force: true });
  }

  beforeEach(() => {
    cleanDirs();
    if (!existsSync(testGeneratedDir)) mkdirSync(testGeneratedDir, { recursive: true });
    if (!existsSync(testTemplatesDir)) mkdirSync(testTemplatesDir, { recursive: true });
  });

  afterEach(cleanDirs);

  async function runPlugin(config: Config[], options: any = {}) {
    const plugin = mpaPlugin({
      config,
      generatedDir: testGeneratedDir,
      ...options,
    });

    const result = await (plugin as any).config(
      { root: rootDir },
      { command: "build", mode: "production" },
    );

    return { result };
  }

  it("HTML 模板优先级：页面级应覆盖全局级", async () => {
    const globalTemplate = resolve(testTemplatesDir, "global.html");
    const pageTemplate = resolve(testTemplatesDir, "page.html");

    writeFileSync(globalTemplate, "<html><body>Global</body></html>");
    writeFileSync(pageTemplate, "<html><body>Page</body></html>");

    const { result } = await runPlugin(
      [
        { page: "p1", title: "P1" }, // 使用全局
        { page: "p2", title: "P2", template: pageTemplate }, // 使用页面级
      ],
      { template: globalTemplate },
    );

    const input = result.build.rollupOptions.input;
    const h1 = readFileSync(input["p1"], "utf-8");
    const h2 = readFileSync(input["p2"], "utf-8");

    expect(h1).toContain("Global");
    expect(h2).toContain("Page");
  });

  it("App 模板优先级：页面级应覆盖全局级", async () => {
    const globalApp = resolve(testTemplatesDir, "global-app.vue");
    const pageApp = resolve(testTemplatesDir, "page-app.vue");

    writeFileSync(globalApp, "<template>Global App</template>");
    writeFileSync(pageApp, "<template>Page App</template> // @Page");

    await runPlugin(
      [
        { page: "p1", title: "P1" },
        { page: "p2", title: "P2", appTemplate: pageApp },
      ],
      { appTemplate: globalApp },
    );

    const app1 = readFileSync(resolve(testGeneratedDir, "p1/app.vue"), "utf-8");
    const app2 = readFileSync(resolve(testGeneratedDir, "p2/app.vue"), "utf-8");

    expect(app1).toContain("Global App");
    expect(app2).toContain("Page App");
  });

  it("Main 模板优先级：页面级应覆盖全局级", async () => {
    const globalMain = resolve(testTemplatesDir, "global-main.ts");
    const pageMain = resolve(testTemplatesDir, "page-main.ts");

    writeFileSync(globalMain, "console.log('global')");
    writeFileSync(pageMain, "console.log('page')");

    await runPlugin(
      [
        { page: "p1", title: "P1" },
        { page: "p2", title: "P2", mainTemplate: pageMain },
      ],
      { mainTemplate: globalMain },
    );

    const main1 = readFileSync(resolve(testGeneratedDir, "p1/main.ts"), "utf-8");
    const main2 = readFileSync(resolve(testGeneratedDir, "p2/main.ts"), "utf-8");

    expect(main1).toContain("global");
    expect(main2).toContain("page");
  });

  it("当未指定页面级模板时，应回退到全局模板", async () => {
    const globalTemplate = resolve(testTemplatesDir, "fallback.html");
    writeFileSync(globalTemplate, "<html><body>Fallback</body></html>");

    const { result } = await runPlugin([{ page: "p1", title: "P1" }], { template: globalTemplate });

    const html = readFileSync(result.build.rollupOptions.input["p1"], "utf-8");
    expect(html).toContain("Fallback");
  });
});
