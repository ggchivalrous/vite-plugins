import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { relocateTemplateImports } from "../src/imports";

const filename = resolve("/project/template/main.ts");
const outputFile = resolve("/project/.generated/tools/about/main.ts");

function relocate(content: string) {
  return relocateTemplateImports({ content, filename }, outputFile, new Map());
}

describe("模板模块引用", () => {
  it("重定位 TS 静态导入、导出、字面量动态导入及类型引用", () => {
    const source = [
      "// 中文注释确保替换偏移正确",
      "import '../src/styles/entry'",
      "import type { Item } from '../src/types'",
      "export { value } from '../src/value'",
      'export * from "../src/all"',
      "const load = () => import('../src/lazy')",
      "const loadStatic = () => import(`../src/static`)",
      "type Item = import('../src/types').Item",
      "import legacy = require('../src/legacy')",
    ].join("\n");
    const result = relocate(source);

    expect(result).toContain("import '../../../src/styles/entry'");
    expect(result).toContain("from '../../../src/types'");
    expect(result).toContain("from '../../../src/value'");
    expect(result).toContain('from "../../../src/all"');
    expect(result).toContain("import('../../../src/lazy')");
    expect(result).toContain('import("../../../src/static")');
    expect(result).toContain("type Item = import('../../../src/types').Item");
    expect(result).toContain("require('../../../src/legacy')");
    expect(result).toContain("// 中文注释确保替换偏移正确");
  });

  it("保留生成应用壳、包名、别名、根路径、注释和普通字符串", () => {
    const source = [
      "import App from './app.vue'",
      "import 'vue'",
      "import '@/styles'",
      "import '/src/styles'",
      "import 'https://example.com/module.js'",
      "// import '../comment'",
      "const text = \"import '../string'\"",
      "const load = (name: string) => import('../src/' + name)",
    ].join("\n");
    expect(relocate(source)).toBe(source);
  });

  it("保留 query/hash，并正确转义模块路径中的引号", () => {
    const source = `import image from '../src/image.svg?url#icon'\nimport "../src/it's-here"`;
    expect(relocate(source)).toContain("'../../../src/image.svg?url#icon'");
    expect(relocate(source)).toContain('"../../../src/it\'s-here"');
  });

  it("自定义模板之间的引用指向对应的生成文件", () => {
    const templateOutputs = new Map([
      [resolve("/project/template/shell.vue"), resolve("/project/.generated/tools/about/app.vue")],
    ]);
    const result = relocateTemplateImports(
      { content: "import App from './shell.vue'", filename },
      outputFile,
      templateOutputs,
    );
    expect(result).toBe("import App from './app.vue'");
  });

  it("同时处理 Vue script/setup，保留 template 和 style 中的文本", () => {
    const content = `<script lang="ts">export { value } from '../src/value'</script>
<script setup lang="ts">import Header from '../src/header.vue'</script>
<template><Header /><p>import '../example'</p></template>
<style>.example::after { content: "import '../example'"; }</style>`;
    const result = relocateTemplateImports(
      { content, filename: resolve("/project/template/app.vue") },
      resolve("/project/.generated/about/app.vue"),
      new Map(),
    );
    expect(result).toContain("from '../../src/value'");
    expect(result).toContain("from '../../src/header.vue'");
    expect(result).toContain("<p>import '../example'</p>");
    expect(result).toContain("content: \"import '../example'\"");
  });

  it("内置模板没有来源文件时保持原样", () => {
    const content = "import App from './app.vue'";
    expect(relocateTemplateImports({ content }, outputFile, new Map())).toBe(content);
  });
});
