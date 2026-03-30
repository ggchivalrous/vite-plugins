import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { MetaTag } from "./type";

export function createLogger(verbose: boolean) {
  return {
    info: (msg: string) => verbose && console.log(`[vite-plugin-mpa] ℹ️ ${msg}`),
    warn: (msg: string) => console.warn(`[vite-plugin-mpa] ⚠️ ${msg}`),
    success: (msg: string) => console.log(`[vite-plugin-mpa] ✅ ${msg}`),
  };
}

/**
 * 将 meta 标签配置数组渲染为 HTML 字符串
 */
export function genMetas(metas: MetaTag[]): string {
  return metas
    .map((meta) => {
      const attrs = Object.entries(meta)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      return `  <meta ${attrs} />`;
    })
    .join("\n");
}

/**
 * 计算从 HTML 文件所在目录到 Vite root 的相对路径前缀
 *
 * HTML 文件路径规则：
 * - outputPath === 'index' → {htmlDir}/index.html（在 htmlDir 根部，深度 = segments 层）
 * - 其他 → {htmlDir}/{outputPath}/index.html（深度 = segments + 1 层）
 */
export function calcRelativePrefix(outputPath: string): string {
  const segments = outputPath.split("/").length;
  const depth = outputPath === "index" ? segments : segments + 1;
  return "../".repeat(depth);
}

/**
 * 递归扫描目录，收集指定文件名的所有完整路径
 */
export function scanMpaConfigFiles(dir: string, fileName: string | string[]): string[] {
  const result: string[] = [];
  if (!existsSync(dir)) return result;

  const fileNames = Array.isArray(fileName) ? fileName : [fileName];

  for (const file of readdirSync(dir)) {
    const fullPath = join(dir, file);
    const stat = statSync(fullPath);
    if (stat.isDirectory() && file !== "node_modules" && file !== ".git") {
      result.push(...scanMpaConfigFiles(fullPath, fileName));
    } else if (stat.isFile() && fileNames.includes(file)) {
      result.push(fullPath);
    }
  }
  return result;
}
