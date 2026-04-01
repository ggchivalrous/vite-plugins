import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, relative } from "node:path";
import { type ConfigEnv, loadConfigFromFile, type Plugin, normalizePath } from "vite";
import { defaultAppTemp, defaultHtmlTemp, defaultMainTemp } from "./template";
import type { Config, MetaTag, ViteMpaOptions } from "./type";
import { calcRelativePrefix, createLogger, genMetas, scanMpaConfigFiles } from "./utils";

export type { Config, MetaTag, ViteMpaOptions };

const defaultConfigNames = ["mpa.config.ts", "mpa.config.js", "mpa.config.mjs", "mpa.config.cjs"];

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
 * 从 Vite loadConfigFromFile 的返回值中提取 Config 数组
 */
function extractConfigArray(raw: unknown): Config[] {
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
async function readConfig(
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

export function mpaPlugin(options: ViteMpaOptions = {}): Plugin {
  const urlMap: Record<string, string> = {};

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
      const pagesDir = resolvePath(options.pagesDir, "src/pages");

      // 清空目录
      if (existsSync(generatedDir)) {
        rmSync(generatedDir, { recursive: true });
      }
      mkdirSync(generatedDir, { recursive: true });

      const mpaConfig = await readConfig(options, configEnv, rootDir, logger);

      if (!mpaConfig || mpaConfig.length === 0) {
        logger.warn("未提供 MPA 页面配置。如需生成多个入口，请通过 config或scanDir。");
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
      const printList: Array<{ Page: string; Entry: string; Component: string }> = [];

      for (const config of mpaConfig) {
        const appEntry = config.appEntry ?? "index";
        const entryList = Array.isArray(appEntry) ? appEntry : [appEntry];

        for (const entry of entryList) {
          // 确定生成目录名和 HTML 输出路径名
          const isDefaultEntry = entry === "index";
          const outputDefaultEntry = config.output === "index";

          // 仅当默认入口时 output 才有意义（子入口不支持 output 重定向）
          // 该支持是为了 home 或其他主页 页面可以直接指定为 /index.html
          const outputPath = isDefaultEntry ? config.page : `${config.page}/${entry}`;
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
          let absolutePagePath: string;

          if (config.component) {
            // 如果单独配置了组件本身（通常用于单入口页面）
            absolutePagePath = normalizePath(
              isAbsolute(config.component) ? config.component : resolve(rootDir, config.component),
            );
          } else if (config.sourceDir) {
            // 如果单独配置了组件目录
            const customDir = isAbsolute(config.sourceDir)
              ? config.sourceDir
              : resolve(rootDir, config.sourceDir);
            absolutePagePath = normalizePath(resolve(customDir, `${pageFile}.vue`));
          } else {
            // 默认从全局的 pagesDir 获取
            absolutePagePath = normalizePath(resolve(pagesDir, `${pageFile}.vue`));
          }

          writeFileSync(
            appPath,
            appTempStr.replace("// @Page", `import Page from '${absolutePagePath}'`),
            "utf-8",
          );
          logger.info(`生成 app.vue: ${appPath}`);

          // 写入 HTML
          const htmlContent = generateHtml(htmlTempStr, outputPath, config, generatedDirName);
          const htmlPath = join(
            generatedDir,
            outputDefaultEntry ? "index.html" : `${outputPath}/index.html`,
          );
          const htmlDirPath = dirname(htmlPath);
          if (!existsSync(htmlDirPath)) {
            mkdirSync(htmlDirPath, { recursive: true });
          }
          writeFileSync(htmlPath, htmlContent, "utf-8");
          logger.info(`生成 HTML: ${htmlPath}`);

          entries[outputPath] = htmlPath;
          printList.push({
            Page: config.page,
            Entry: `/${outputDefaultEntry ? "index.html" : `${outputPath}/index.html`}`,
            Component: normalizePath(relative(rootDir, absolutePagePath)),
          });

          // 记录 Dev Server 需要的路由改写映射
          const defaultHtmlUrl = `/${outputDefaultEntry ? "index.html" : `${outputPath}/index.html`}`;
          const actualServePath = `/${generatedDirName}${defaultHtmlUrl}`;
          urlMap[defaultHtmlUrl] = actualServePath;
          if (outputDefaultEntry) {
            urlMap["/"] = actualServePath;
          } else {
            urlMap[`/${outputPath}`] = actualServePath;
            urlMap[`/${outputPath}/`] = actualServePath;
          }
        }
      }

      logger.success(
        `✨ 共处理 ${mpaConfig.length} 个配置，生成 ${Object.keys(entries).length} 个页面入口`,
      );

      if (printList.length > 0) {
        let maxPage = 4;
        let maxEntry = 5;
        printList.forEach((p) => {
          maxPage = Math.max(maxPage, p.Page.length);
          maxEntry = Math.max(maxEntry, p.Entry.length);
        });

        console.log(
          `\n\x1b[90m${"Page".padEnd(maxPage)}   ${"Entry".padEnd(maxEntry)}   Component\x1b[0m`,
        );
        printList.forEach((p) => {
          const page = `\x1b[36m${p.Page.padEnd(maxPage)}\x1b[0m`;
          const entry = `\x1b[32m${p.Entry.padEnd(maxEntry)}\x1b[0m`;
          const comp = `\x1b[33m${p.Component}\x1b[0m`;
          console.log(`${page}   ${entry}   ${comp}`);
        });
        console.log();
      }

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

    configureServer(server) {
      // 在开发环境拦截用户的 URL 并将他们定向到生成的真正的 HTML
      server.middlewares.use((req, res, next) => {
        if (req.url) {
          const pathname = req.url.split("?")[0];
          if (urlMap[pathname]) {
            req.url = req.url.replace(pathname, urlMap[pathname]);
          }
        }
        next();
      });
    },

    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url) {
          const pathname = req.url.split("?")[0];
          if (urlMap[pathname]) {
            req.url = req.url.replace(pathname, urlMap[pathname]);
          }
        }
        next();
      });
    },
  };
}

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
