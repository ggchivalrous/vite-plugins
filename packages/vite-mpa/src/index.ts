import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { type ConfigEnv, normalizePath, type Plugin } from "vite";
import { defaultAppTemp, defaultHtmlTemp, defaultMainTemp } from "./template";
import type { Config, MetaTag, ViteMpaOptions } from "./type";
import {
  calcRelativePrefix,
  createLogger,
  defaultConfigNames,
  genMetas,
  readConfig,
} from "./utils";

export type { Config, MetaTag, ViteMpaOptions };

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

export function mpaPlugin(options: ViteMpaOptions = {}): Plugin {
  const urlMap: Record<string, string> = {};

  let resolvedViteConfig: any;
  let resolvedConfigEnv: ConfigEnv;

  return {
    name: "vite-plugin-mpa",
    enforce: "pre",

    async config(viteConfig, configEnv) {
      resolvedViteConfig = viteConfig;
      resolvedConfigEnv = configEnv;

      const entries = await generateFiles(viteConfig, configEnv, options, urlMap);
      if (!entries) return;

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

      // 监听 MPA 配置文件，如果发生增删改，自动重新生成并重刷页面
      const isMpaConfig = (file: string) => {
        const fileNames = Array.isArray(options.scanFile)
          ? options.scanFile
          : options.scanFile
            ? [options.scanFile]
            : defaultConfigNames;
        return fileNames.some((name) => file.endsWith(name));
      };

      const handleWatch = async (file: string, type: "change" | "add" | "unlink") => {
        if (isMpaConfig(file)) {
          if (type === "unlink" && options.restartOnUnlink) {
            server.config.logger.info(`✨ MPA 配置文件删除，正在重启服务: ${file}`, {
              timestamp: true,
              clear: true,
            });
            void server.restart();
          } else {
            server.config.logger.info(`✨ MPA 配置文件发生改变，正在重新生成页面入口: ${file}`, {
              timestamp: true,
              clear: true,
            });
            if (resolvedViteConfig && resolvedConfigEnv) {
              await generateFiles(resolvedViteConfig, resolvedConfigEnv, options, urlMap, true);
              server.ws.send({ type: "full-reload" });
            }
          }
        }
      };

      server.watcher.on("add", (f) => handleWatch(f, "add"));
      server.watcher.on("change", (f) => handleWatch(f, "change"));
      server.watcher.on("unlink", (f) => handleWatch(f, "unlink"));
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
 * 根据页面配置和入口名解析出相关的路径和状态
 */
function resolvePagePaths(config: Config, entry: string) {
  const isDefaultEntry = entry === "index";
  const outputDefaultEntry = config.output === "index" && isDefaultEntry;

  // 仅当默认入口时 output 才有意义（子入口不支持 output 重定向）
  const outputPath = isDefaultEntry ? config.page : `${config.page}/${entry}`;
  const htmlRelativePath = outputDefaultEntry ? "index.html" : `${outputPath}/index.html`;

  return {
    outputPath,
    htmlRelativePath,
    isDefaultEntry,
    outputDefaultEntry,
  };
}

async function generateFiles(
  viteConfig: any,
  configEnv: ConfigEnv,
  options: ViteMpaOptions,
  urlMap: Record<string, string>,
  isHotUpdate = false,
) {
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

  if (!isHotUpdate) {
    logger.success(`🔨 开始生成工具页面 HTML 和入口文件...`);
  }

  const globalAppTempStr = getTemplateContent(options.appTemplate, defaultAppTemp, rootDir, logger);
  const globalMainTempStr = getTemplateContent(options.mainTemplate, defaultMainTemp, rootDir, logger);
  // 全局 HTML 模板（作为各页面的默认回退）
  const globalHtmlTempStr = getTemplateContent(options.template, defaultHtmlTemp, rootDir, logger);

  const entries: Record<string, string> = {};
  const printList: Array<{ Page: string; Entry: string; Component: string }> = [];

  // 清空旧映射
  for (const key in urlMap) delete urlMap[key];

  for (const config of mpaConfig) {
    const appEntry = config.appEntry ?? "index";
    const entryList = Array.isArray(appEntry) ? appEntry : [appEntry];

    // 解析当前页面使用的各模板，优先级：页面级 > 全局 > 内置默认
    const htmlTempStr = config.template
      ? getTemplateContent(config.template, globalHtmlTempStr, rootDir, logger)
      : globalHtmlTempStr;
    const appTempStr = config.appTemplate
      ? getTemplateContent(config.appTemplate, globalAppTempStr, rootDir, logger)
      : globalAppTempStr;
    const mainTempStr = config.mainTemplate
      ? getTemplateContent(config.mainTemplate, globalMainTempStr, rootDir, logger)
      : globalMainTempStr;

    for (const entry of entryList) {
      const { outputPath, htmlRelativePath, isDefaultEntry, outputDefaultEntry } =
        resolvePagePaths(config, entry);

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
      const htmlPath = join(generatedDir, htmlRelativePath);
      const htmlDirPath = dirname(htmlPath);
      if (!existsSync(htmlDirPath)) {
        mkdirSync(htmlDirPath, { recursive: true });
      }
      writeFileSync(htmlPath, htmlContent, "utf-8");
      logger.info(`生成 HTML: ${htmlPath}`);

      entries[outputPath] = htmlPath;
      printList.push({
        Page: config.page,
        Entry: `/${outputDefaultEntry ? "" : `${outputPath}`}`,
        Component: normalizePath(relative(rootDir, absolutePagePath)),
      });

      // 记录 Dev Server 需要的路由改写映射
      const defaultHtmlUrl = `/${htmlRelativePath}`;
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

  if (!isHotUpdate) {
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
  }

  return entries;
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

/**
 * 解析并获取 MPA 插件生成的所有页面入口列表。
 * 可用于 SSG 预渲染、自动化测试或其他需要遍历页面入口的场景。
 *
 * @example
 * // 配合 vite-plugin-ssg 使用
 * // vite.config.ts
 * import { mpaPlugin, resolveMpaEntries } from '@ggcv/vite-plugin-mpa'
 * import { ssgPlugin } from '@ggcv/vite-plugin-ssg'
 *
 * const options = { ... }
 *
 * export default defineConfig(async (env) => {
 *   return {
 *     plugins: [
 *       mpaPlugin(options),
 *       ssgPlugin({
 *         entries: await resolveMpaEntries(options, env),
 *       }),
 *     ],
 *   }
 * })
 */
export async function resolveMpaEntries(
  options: ViteMpaOptions = {},
  configEnv: ConfigEnv = { command: "build", mode: "production" },
  rootDir: string = process.cwd(),
) {
  const logger = createLogger(false);
  const mpaConfig = await readConfig(options, configEnv, rootDir, logger);

  const resolvePath = (opt: string | undefined, fallback: string) =>
    opt ? (isAbsolute(opt) ? opt : resolve(rootDir, opt)) : resolve(rootDir, fallback);

  const generatedDir = resolvePath(options.generatedDir, ".generated");

  const mpaEntries: Array<{ entry: string; html: string }> = [];

  for (const config of mpaConfig) {
    const appEntry = config.appEntry ?? "index";
    const entryList = Array.isArray(appEntry) ? appEntry : [appEntry];

    for (const entry of entryList) {
      const { outputPath, htmlRelativePath } = resolvePagePaths(config, entry);

      const htmlPath = htmlRelativePath;
      const entryPath = join(generatedDir, outputPath, "main.ts");

      mpaEntries.push({
        entry: normalizePath(entryPath),
        html: normalizePath(htmlPath),
      });
    }
  }

  return mpaEntries;
}
