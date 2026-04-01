import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { Config, MetaTag, ViteMpaOptions } from "./type";
import { loadConfigFromFile, type ConfigEnv } from "vite";

export const defaultConfigNames = [
  "mpa.config.ts",
  "mpa.config.js",
  "mpa.config.mjs",
  "mpa.config.cjs",
];

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

/**
 * 从 Vite loadConfigFromFile 的返回值中提取 Config 数组
 */
export function extractConfigArray(raw: unknown): Config[] {
  if (!raw) return [];
  let value = raw as any;

  // 支持 defineMpaConfig() 的返回格式
  if (value.__viteMpaPluginConfig !== undefined) {
    value = value.__viteMpaPluginConfig;
  } else if (value.config !== undefined) {
    value = value.config;
  } else if (value.default !== undefined) {
    value = value.default;
    // 嵌套 defineMpaConfig
    if (value?.__viteMpaPluginConfig !== undefined) {
      value = value.__viteMpaPluginConfig;
    }
  }

  if (Array.isArray(value)) return value as Config[];
  if (typeof value === "object" && value !== null) return [value as Config];
  return [];
}

/**
 * 根据插件选项加载完整的 Config 列表
 */
export async function readConfig(
  options: ViteMpaOptions,
  configEnv: ConfigEnv,
  rootDir: string,
  logger: ReturnType<typeof createLogger>,
): Promise<Config[]> {
  // 直接配置
  if (Array.isArray(options.config)) {
    return options.config;
  }

  // 配置文件路径
  if (typeof options.config === "string") {
    const configPath = isAbsolute(options.config)
      ? options.config
      : resolve(rootDir, options.config);

    if (existsSync(configPath)) {
      const res = await loadConfigFromFile(configEnv, configPath, rootDir);
      if (res?.config) {
        return extractConfigArray(res.config);
      }
    }
    logger.warn(`未找到指定的配置文件: ${configPath}`);
    return [];
  }

  // 扫描指定目录
  if (options.scanDir) {
    const scanDirPath = isAbsolute(options.scanDir)
      ? options.scanDir
      : resolve(rootDir, options.scanDir);

    if (!existsSync(scanDirPath)) {
      logger.warn(`未找到指定的扫描目录: ${scanDirPath}`);
      return [];
    }

    const configFiles = scanMpaConfigFiles(scanDirPath, options.scanFile || defaultConfigNames);
    logger.info(`在 ${scanDirPath} 中发现 ${configFiles.length} 个配置文件`);

    const mergedConfigs: Config[] = [];
    for (const file of configFiles) {
      const res = await loadConfigFromFile(configEnv, file, rootDir);
      if (res?.config) {
        mergedConfigs.push(...extractConfigArray(res.config));
      }
    }
    return mergedConfigs;
  }

  // 在 baseDir 查找默认配置文件
  const baseDir = options.baseDir
    ? isAbsolute(options.baseDir)
      ? options.baseDir
      : resolve(rootDir, options.baseDir)
    : rootDir;

  for (const name of defaultConfigNames) {
    const configPath = resolve(baseDir, name);
    if (existsSync(configPath)) {
      logger.info(`找到默认配置文件: ${configPath}`);
      const res = await loadConfigFromFile(configEnv, configPath, rootDir);
      if (res?.config) {
        return extractConfigArray(res.config);
      }
    }
  }

  return [];
}
