import type { ESTree } from "vite";
import { dirname, relative, resolve } from "node:path";
import { parse as parseSfc } from "@vue/compiler-sfc";
import { normalizePath, parseSync, Visitor } from "vite";

export interface TemplateSource {
  content: string;
  filename?: string;
}

/**
 * 模板外部模块仍指向原文件；模板之间的引用指向本次生成的对应文件。
 */
export function relocateTemplateImports(
  template: TemplateSource,
  outputFile: string,
  templateOutputs: ReadonlyMap<string, string>,
): string {
  const { content, filename } = template;
  if (!filename) return content;

  const edits: Array<{ start: number; end: number; text: string }> = [];

  function relocate(specifier: string): string {
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) return specifier;

    const suffixIndex = specifier.search(/[?#]/);
    const pathname = suffixIndex < 0 ? specifier : specifier.slice(0, suffixIndex);
    const suffix = suffixIndex < 0 ? "" : specifier.slice(suffixIndex);

    // 内置 main.ts 约定的 ./app.vue 始终是生成的应用壳，即使页面覆盖了 appTemplate。
    if (pathname === "./app.vue") return specifier;

    const sourceFile = resolve(dirname(filename!), pathname);
    const targetFile = templateOutputs.get(sourceFile) ?? sourceFile;
    const outputPath = normalizePath(relative(dirname(outputFile), targetFile));
    return (outputPath.startsWith(".") ? outputPath : `./${outputPath}`) + suffix;
  }

  function visitScript(code: string, scriptFile: string, offset: number) {
    const { program, errors } = parseSync(scriptFile, code);
    if (errors.length) {
      throw new Error(`[vite-plugin-mpa] 无法解析模板 ${filename}: ${errors[0]!.message}`);
    }

    function rewrite(node: ESTree.Node | null | undefined) {
      let value: string | null | undefined;
      if (node?.type === "Literal" && typeof node.value === "string") value = node.value;
      if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
        value = node.quasis[0]?.value.cooked;
      }
      if (!node || typeof value !== "string") return;

      const replacement = relocate(value);
      if (replacement === value) return;

      // 只替换模块标识符，保留模板其他代码、注释和格式。
      const quote = code[node.start] === "'" ? "'" : '"';
      const escaped = JSON.stringify(replacement).slice(1, -1);
      edits.push({
        start: offset + node.start,
        end: offset + node.end,
        text: quote + (quote === "'" ? escaped.replaceAll("'", "\\'") : escaped) + quote,
      });
    }

    new Visitor({
      ImportDeclaration: (node) => rewrite(node.source),
      ExportNamedDeclaration: (node) => rewrite(node.source),
      ExportAllDeclaration: (node) => rewrite(node.source),
      ImportExpression: (node) => rewrite(node.source),
      TSImportType: (node) => rewrite(node.source),
      TSExternalModuleReference: (node) => rewrite(node.expression),
    }).visit(program);
  }

  if (outputFile.endsWith(".vue")) {
    const { descriptor, errors } = parseSfc(content, { filename });
    if (errors.length) {
      throw new Error(`[vite-plugin-mpa] 无法解析模板 ${filename}: ${String(errors[0])}`);
    }

    for (const block of [descriptor.script, descriptor.scriptSetup]) {
      if (!block || block.src) continue;
      visitScript(block.content, `${filename}.${block.lang ?? "js"}`, block.loc.start.offset);
    }
  } else {
    visitScript(content, filename, 0);
  }

  let result = content;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}
