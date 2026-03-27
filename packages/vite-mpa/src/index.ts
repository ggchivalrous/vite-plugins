import { type Plugin, type ConfigEnv, loadConfigFromFile } from "vite";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, isAbsolute, basename } from "node:path";
import type { Config, MetaTag, ViteMpaOptions } from "./type";
import { defaultMainTemp, defaultAppTemp, defaultHtmlTemp } from "./template";

function createLogger(verbose: boolean) {
  return {
    info: (msg: string) => verbose && console.log(`[vite-plugin-mpa] ℹ️ ${msg}`),
    warn: (msg: string) => console.warn(`[vite-plugin-mpa] ⚠️ ${msg}`),
    success: (msg: string) => console.log(`[vite-plugin-mpa] ✅ ${msg}`),
  };
}

/**
 * 将 meta 标签配置数组渲染为 HTML 字符串
 */
function genMetas(metas: MetaTag[]): string {
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
function calcRelativePrefix(outputPath: string): string {
  const segments = outputPath.split("/").length;
  const depth = outputPath === "index" ? segments : segments + 1;
  return "../".repeat(depth);
}

/**
 * 渲染最终的 HTML 内容
 */
function generateHtml(
  htmlTemp: string,
  outputPath: string,
  config: Config,
  generatedDirName: string,
): string {
  const metaStr = config.metas && config.metas.length > 0 ? genMetas(config.metas) : "";
  const prefix = calcRelativePrefix(outputPath);
  const favicon = config.favicon ?? `/${outputPath}.svg`;

  return (
    htmlTemp
      .replace("%META%", metaStr ? `${metaStr}\n` : "")
      .replace("%TITLE%", config.title)
      // 向后兼容旧模板中使用 %VITE_APP_NAME% 的情况
      .replace("%VITE_APP_NAME%", config.title)
      .replace("%FAVICON%", favicon)
      .replace("%ENTRY%", `${prefix}${generatedDirName}/${outputPath}/main.ts`)
  );
}

/**
 * 读取自定义模板内容，若文件不存在则回退到默认内容
 */
function getTemplateContent(
  customPath: string | undefined,
  defaultContent: string,
  rootDir: string,
  logger: ReturnType<typeof createLogger>,
): string {
  if (customPath) {
    const fullPath = isAbsolute(customPath) ? customPath : resolve(rootDir, customPath);
    if (existsSync(fullPath)) {
      return readFileSync(fullPath, "utf-8");
    }
    logger.warn(`未找到自定义模板文件: ${fullPath}，将使用内置默认模板。`);
  }
  return defaultContent;
}

/**
 * 递归扫描目录，收集指定文件名的所有完整路径
 */
function scanMpaConfigFiles(dir: string, fileName: string): string[] {
  const result: string[] = [];
  if (!existsSync(dir)) return result;

  for (const file of readdirSync(dir)) {
    const fullPath = join(dir, file);
    const stat = statSync(fullPath);
    if (stat.isDirectory() && file !== "node_modules" && file !== ".git") {
      result.push(...scanMpaConfigFiles(fullPath, fileName));
    } else if (stat.isFile() && file === fileName) {
      result.push(fullPath);
    }
  }
  return result;
}

/**
 * 从 Vite loadConfigFromFile 的返回值中提取 Config 数组
 */
function extractConfigArray(raw: unknown): Config[] {
  if (!raw) return [];
  let value = raw as any;

  // 支持 defineMpaConfig() 的返回格式
  if (value.__viteMpaPluginConfig !== undefined) {
    value = value.__viteMpaPluginConfig;
  } else if (value.toolsConfig !== undefined) {
    value = value.toolsConfig;
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
async function readToolsConfig(
  options: ViteMpaOptions,
  configEnv: ConfigEnv,
  rootDir: string,
  logger: ReturnType<typeof createLogger>,
): Promise<Config[]> {
  // 1. 直接传入数组
  if (Array.isArray(options.toolsConfig)) {
    return options.toolsConfig;
  }

  // 2. 传入配置文件路径
  if (typeof options.toolsConfig === "string") {
    const configPath = isAbsolute(options.toolsConfig)
      ? options.toolsConfig
      : resolve(rootDir, options.toolsConfig);

    if (existsSync(configPath)) {
      const res = await loadConfigFromFile(configEnv, configPath, rootDir);
      if (res?.config) {
        return extractConfigArray(res.config);
      }
    }
    logger.warn(`未找到指定的配置文件: ${configPath}`);
    return [];
  }

  // 3. 扫描目录
  if (options.scanDir) {
    const scanDirPath = isAbsolute(options.scanDir)
      ? options.scanDir
      : resolve(rootDir, options.scanDir);

    if (!existsSync(scanDirPath)) {
      logger.warn(`未找到指定的扫描目录: ${scanDirPath}`);
      return [];
    }

    const scanFileName = options.scanFile || "vite-mpa.ts";
    const configFiles = scanMpaConfigFiles(scanDirPath, scanFileName);
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

  // 4. 在 baseDir 查找默认配置文件
  const baseDir = options.baseDir
    ? isAbsolute(options.baseDir)
      ? options.baseDir
      : resolve(rootDir, options.baseDir)
    : rootDir;

  const defaultConfigNames = ["mpa.config.ts", "mpa.config.js", "mpa.config.mjs", "mpa.config.cjs"];

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

export function mpaPlugin(options: ViteMpaOptions = {}): Plugin {
  return {
    name: "vite-plugin-mpa",
    enforce: "pre",

    async config(viteConfig, configEnv) {
      const rootDir = viteConfig.root || process.cwd();
      const logger = createLogger(options.verbose ?? false);

      // 解析目录路径（统一支持相对/绝对路径）
      const resolvePath = (opt: string | undefined, fallback: string) =>
        opt ? (isAbsolute(opt) ? opt : resolve(rootDir, opt)) : resolve(rootDir, fallback);

      const generatedDir = resolvePath(options.generatedDir, ".generated");
      const generatedDirName = basename(generatedDir);

      if (!existsSync(generatedDir)) {
        mkdirSync(generatedDir, { recursive: true });
      }

      const toolsConfig = await readToolsConfig(options, configEnv, rootDir, logger);

      if (!toolsConfig || toolsConfig.length === 0) {
        logger.warn(
          "未提供 MPA 页面配置。如需生成多个入口，请通过 toolsConfig、scanDir 或配置文件指定。",
        );
        return;
      }

      logger.success(`🔨 开始生成工具页面 HTML 和入口文件...`);

      const appTempStr = getTemplateContent(options.appTemplate, defaultAppTemp, rootDir, logger);
      const mainTempStr = getTemplateContent(
        options.mainTemplate,
        defaultMainTemp,
        rootDir,
        logger,
      );
      const htmlTempStr = getTemplateContent(options.template, defaultHtmlTemp, rootDir, logger);

      const entries: Record<string, string> = {};

      for (const config of toolsConfig) {
        const appEntry = config.appEntry ?? "index";
        const entryList = Array.isArray(appEntry) ? appEntry : [appEntry];

        for (const entry of entryList) {
          // 确定生成目录名和 HTML 输出路径名
          const isDefaultEntry = entry === "index";
          // 仅当默认入口时 output 才有意义（子入口不支持 output 重定向）
          const outputPath = isDefaultEntry
            ? (config.output ?? config.page)
            : `${config.page}/${entry}`;

          const pageFile = isDefaultEntry ? `${config.page}/index` : `${config.page}/${entry}`;
          const generatedEntryDir = resolve(generatedDir, outputPath);

          if (!existsSync(generatedEntryDir)) {
            mkdirSync(generatedEntryDir, { recursive: true });
          }

          // 写入 main.ts
          const mainPath = resolve(generatedEntryDir, "main.ts");
          writeFileSync(mainPath, mainTempStr, "utf-8");
          logger.info(`生成 main.ts: ${mainPath}`);

          // 写入 app.vue
          const appPath = resolve(generatedEntryDir, "app.vue");
          writeFileSync(
            appPath,
            appTempStr
              .replace("// @Page", `import Page from '@pages/${pageFile}.vue'`)
              .replace("// @Main", `import AppMain from '@/tool-app-main.vue'`),
            "utf-8",
          );
          logger.info(`生成 app.vue: ${appPath}`);

          // 写入 HTML
          const htmlContent = generateHtml(htmlTempStr, outputPath, config, generatedDirName);
          const htmlPath = join(
            generatedDir,
            outputPath === "index" ? "index.html" : `${outputPath}/index.html`,
          );
          const htmlDirPath = dirname(htmlPath);
          if (!existsSync(htmlDirPath)) {
            mkdirSync(htmlDirPath, { recursive: true });
          }
          writeFileSync(htmlPath, htmlContent, "utf-8");
          logger.info(`生成 HTML: ${htmlPath}`);

          entries[outputPath] = htmlPath;
        }
      }

      logger.success(
        `✨ 共处理 ${toolsConfig.length} 个配置，生成 ${Object.keys(entries).length} 个页面入口`,
      );

      // 合并已有的 rollupOptions.input
      const userInputs = viteConfig.build?.rollupOptions?.input;
      let inputConfig: Record<string, string> | string[] | string = entries;

      if (userInputs) {
        if (Array.isArray(userInputs)) {
          inputConfig = [...userInputs, ...Object.values(entries)];
        } else if (typeof userInputs === "object") {
          inputConfig = { ...userInputs, ...entries };
        } else {
          // userInputs 是字符串
          inputConfig = { _default: userInputs, ...entries };
        }
      }

      return {
        build: {
          rollupOptions: {
            input: inputConfig,
          },
        },
      };
    },
  };
}

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

/**
 * 定义 MPA 配置（用于配置文件中，提供类型提示）。
 *
 * @example
 * // mpa.config.ts
 * import { defineMpaConfig } from '@ggcv/vite-plugin-mpa'
 * export default defineMpaConfig([
 *   { page: 'home', title: '首页' },
 *   { page: 'about', title: '关于我们' },
 * ])
 */
export function defineMpaConfig(config: Config | Config[]) {
  return { __viteMpaPluginConfig: Array.isArray(config) ? config : [config] };
}
