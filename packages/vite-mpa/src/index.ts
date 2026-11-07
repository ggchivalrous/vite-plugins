import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { type ConfigEnv, normalizePath, type Plugin } from "vite";
import { defaultAppTemp, defaultHtmlTemp, defaultMainTemp } from "./template";
import { relocateTemplateImports, type TemplateSource } from "./imports";
import type { Config, MetaTag, ViteMpaOptions } from "./type";
import { createLogger, defaultConfigNames, genMetas, readConfig } from "./utils";

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
  const favicon = config.favicon ?? `/${outputPath}.svg`;

  return (
    htmlTemp
      .replace("%META%", metaStr ? `${metaStr}\n` : "")
      .replace("%TITLE%", config.title)
      // 向后兼容旧模板中使用 %VITE_APP_NAME% 的情况
      .replace("%VITE_APP_NAME%", config.title)
      .replace("%FAVICON%", favicon)
      // 使用绝对路径，避免开发模式 URL 重写后浏览器计算相对路径异常
      .replace("%ENTRY%", `/${generatedDirName}/${outputPath}/main.ts`)
  );
}

/**
 * 读取模板并保留来源路径；文件不存在时继承回退模板的内容与来源。
 */
function readTemplate(
  customPath: string | undefined,
  fallback: TemplateSource,
  rootDir: string,
  logger: ReturnType<typeof createLogger>,
): TemplateSource {
  if (customPath) {
    const fullPath = resolve(rootDir, customPath);
    if (existsSync(fullPath)) {
      return { content: readFileSync(fullPath, "utf-8"), filename: fullPath };
    }
    logger.warn(`未找到自定义模板文件: ${fullPath}，将使用回退模板。`);
  }
  return fallback;
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

    transformIndexHtml: {
      // order: 'post' 确保在 Vite 注入 script/link 资源引用之后运行
      // 此时 HTML 中已有带 hash 的资源路径，且不含用户导航链接（用户链接是客户端路由）
      order: "post",
      handler(html, ctx) {
        // 仅在构建时处理，开发环境由 urlMap 中间件负责路由
        if (resolvedConfigEnv?.command !== "build") return html;

        const gDir = options.generatedDir || ".generated";
        const gDirName = basename(gDir);
        const normalizedFilename = normalizePath(ctx.filename || "");

        // 只处理位于 .generated 目录下的 HTML
        if (!normalizedFilename.includes(`/${gDirName}/`)) return html;

        // 获取 Vite 配置的 assetsDir（默认为 "assets"）
        const assetsDir = resolvedViteConfig?.build?.assetsDir ?? "assets";
        // 对 assetsDir 进行正则转义（以防含特殊字符）
        const escapedAssetsDir = assetsDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        // 匹配 href/src 属性中 ../的序列 + assetsDir，精确针对 Vite 注入的资源路径
        // 例如：href="../../assets/xxx" → href="../assets/xxx"（减少一层 ../）
        // 这样避免了误伤用户写的 <a href="../about"> 等导航链接
        const re = new RegExp(`(href|src)="((?:\\.\\.\\/)+)(${escapedAssetsDir}\\/)`, "g");

        return html.replace(re, (_, attr, levels, assetPath) => {
          // 减少恰好一层 ../（因为文件向上移动了一层）
          const newLevels = levels.slice("../".length);
          return `${attr}="${newLevels}${assetPath}`;
        });
      },
    },

    generateBundle: {
      order: "post",
      handler(_, bundle) {
        // 仅重命名 bundle 中以 .generated/ 开头的文件（如能命中）
        // HTML 路径已由 transformIndexHtml 在内存阶段修复，此处无需再处理 HTML 内容
        const gDir = options.generatedDir || ".generated";
        const gDirName = basename(gDir);
        const prefix = `${gDirName}/`;

        for (const fileName of Object.keys(bundle)) {
          if (fileName.startsWith(prefix)) {
            const asset = bundle[fileName];
            const newFileName = fileName.slice(prefix.length);

            if (bundle[newFileName]) continue;

            if (asset.type !== "asset") continue;
            this.emitFile({ type: "asset", fileName: newFileName, source: asset.source });
            delete bundle[fileName];
          }
        }
      },
    },

    closeBundle() {
      // 兜底：某些情况下 Vite 直接写入磁盘而绕过 bundle，
      // 此时物理移动文件即可 —— 路径已由 transformIndexHtml 在写入前修正
      if (resolvedConfigEnv?.command !== "build") return;

      const rootDir = resolvedViteConfig?.root || process.cwd();
      const outDir = resolvedViteConfig?.build?.outDir || "dist";
      const fullOutDir = isAbsolute(outDir) ? outDir : resolve(rootDir, outDir);

      const gDir = options.generatedDir || ".generated";
      const gDirName = basename(gDir);
      const gOutPath = resolve(fullOutDir, gDirName);

      if (!existsSync(gOutPath)) return;

      const moveDir = (src: string, dest: string) => {
        if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
        const entries = readdirSync(src, { withFileTypes: true });

        for (const entry of entries) {
          const srcPath = join(src, entry.name);
          const destPath = join(dest, entry.name);

          if (entry.isDirectory()) {
            moveDir(srcPath, destPath);
          } else {
            // 目标已存在（已通过 generateBundle 处理）则跳过
            if (existsSync(destPath)) continue;
            renameSync(srcPath, destPath);
          }
        }
      };

      try {
        moveDir(gOutPath, fullOutDir);
        rmSync(gOutPath, { recursive: true, force: true });
      } catch {
        // silent
      }
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

  const globalAppTemplate = readTemplate(
    options.appTemplate,
    { content: defaultAppTemp },
    rootDir,
    logger,
  );
  const globalMainTemplate = readTemplate(
    options.mainTemplate,
    { content: defaultMainTemp },
    rootDir,
    logger,
  );
  // 全局 HTML 模板（作为各页面的默认回退）
  const globalHtmlTemplate = readTemplate(
    options.template,
    { content: defaultHtmlTemp },
    rootDir,
    logger,
  );

  const entries: Record<string, string> = {};
  const printList: Array<{ Page: string; Entry: string; Component: string }> = [];

  // 清空旧映射
  for (const key in urlMap) delete urlMap[key];

  for (const config of mpaConfig) {
    const appEntry = config.appEntry ?? "index";
    const entryList = Array.isArray(appEntry) ? appEntry : [appEntry];

    // 解析当前页面使用的各模板，优先级：页面级 > 全局 > 内置默认
    const htmlTemplate = config.template
      ? readTemplate(config.template, globalHtmlTemplate, rootDir, logger)
      : globalHtmlTemplate;
    const appTemplate = config.appTemplate
      ? readTemplate(config.appTemplate, globalAppTemplate, rootDir, logger)
      : globalAppTemplate;
    const mainTemplate = config.mainTemplate
      ? readTemplate(config.mainTemplate, globalMainTemplate, rootDir, logger)
      : globalMainTemplate;

    for (const entry of entryList) {
      const { outputPath, htmlRelativePath, isDefaultEntry, outputDefaultEntry } = resolvePagePaths(
        config,
        entry,
      );

      const pageFile = isDefaultEntry ? `${config.page}/index` : `${config.page}/${entry}`;
      const generatedEntryDir = resolve(generatedDir, outputPath);

      if (!existsSync(generatedEntryDir)) {
        mkdirSync(generatedEntryDir, { recursive: true });
      }

      const mainPath = resolve(generatedEntryDir, "main.ts");
      const appPath = resolve(generatedEntryDir, "app.vue");
      const templateOutputs = new Map<string, string>();
      if (mainTemplate.filename) templateOutputs.set(mainTemplate.filename, mainPath);
      if (appTemplate.filename) templateOutputs.set(appTemplate.filename, appPath);

      // 写入 main.ts，同时将外部引用重定位到生成入口所在目录。
      writeFileSync(
        mainPath,
        relocateTemplateImports(mainTemplate, mainPath, templateOutputs),
        "utf-8",
      );
      logger.info(`生成 main.ts: ${mainPath}`);

      // 写入 app.vue
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
        relocateTemplateImports(appTemplate, appPath, templateOutputs).replace(
          "// @Page",
          `import Page from '${absolutePagePath}'`,
        ),
        "utf-8",
      );
      logger.info(`生成 app.vue: ${appPath}`);

      // 写入 HTML
      const htmlContent = generateHtml(htmlTemplate.content, outputPath, config, generatedDirName);
      // htmlRelativePath 是逻辑相对路径（如 index.html），物理上写入 generatedDir
      const htmlPath = resolve(
        generatedDir,
        outputDefaultEntry ? "index.html" : `${outputPath}/index.html`,
      );
      const htmlDirPath = dirname(htmlPath);
      if (!existsSync(htmlDirPath)) {
        mkdirSync(htmlDirPath, { recursive: true });
      }
      writeFileSync(htmlPath, htmlContent, "utf-8");
      logger.info(`生成 HTML: ${htmlPath}`);

      // 写入 entries，使用逻辑相对路径作为 key
      entries[outputPath] = htmlPath;

      printList.push({
        Page: config.page,
        Entry: `/${outputDefaultEntry ? "" : `${outputPath}`}`,
        Component: normalizePath(relative(rootDir, absolutePagePath)),
      });

      // 记录 Dev Server 需要的路由改写映射
      const actualServePath = `/${generatedDirName}/${outputDefaultEntry ? "index.html" : `${outputPath}/index.html`}`;
      // 当请求为不带 generatedDir 的原生路径时，重写到实际的 serve 路径
      const originHtmlUrl = `/${htmlRelativePath}`;
      urlMap[originHtmlUrl] = actualServePath;

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

      const entryPath = join(generatedDir, outputPath, "main.ts");

      // generateBundle 已将 HTML 移到最终位置，SSG 和预览均使用该路径。
      mpaEntries.push({
        entry: normalizePath(entryPath),
        html: htmlRelativePath,
      });
    }
  }

  return mpaEntries;
}
