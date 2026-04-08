import type { InlineConfig, Plugin, ResolvedConfig, UserConfig } from "vite";
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

/**
 * 单个 SSG 页面入口
 */
export interface SSGEntry {
  /**
   * SSR 入口模块路径（供 `vite.ssrLoadModule()` 加载）
   *
   * - 相对路径将基于 Vite root 解析
   * - 支持 Vite 的 alias 路径
   *
   * @example './src/main.ts'
   * @example '/src/pages/about/main.ts'
   */
  entry: string;

  /**
   * 对应的输出 HTML 文件路径（相对于 build.outDir）
   *
   * @example 'index.html'
   * @example 'about/index.html'
   */
  html: string;
}

/**
 * 自定义渲染函数的参数
 */
export interface SSGRenderContext {
  /**
   * 入口模块的导出对象（通过 vite.ssrLoadModule 加载得到）
   */
  module: Record<string, any>;

  /**
   * 当前入口配置
   */
  entry: SSGEntry;

  /**
   * 当前 HTML 文件的原始内容
   */
  html: string;
}

/**
 * 自定义渲染函数的返回值
 */
export interface SSGRenderResult {
  /**
   * 渲染后的完整 HTML 字符串
   */
  html: string;
}

export interface SSGPluginOptions {
  /**
   * 需要预渲染的页面列表
   *
   * - `SSGEntry[]` — 静态的入口列表
   * - `() => SSGEntry[] | Promise<SSGEntry[]>` — 动态生成入口（构建时调用）
   *
   * @example
   * ```ts
   * // 单页应用
   * entries: [
   *   { entry: './src/main.ts', html: 'index.html' },
   * ]
   *
   * // 多页应用
   * entries: [
   *   { entry: './src/pages/home/main.ts', html: 'index.html' },
   *   { entry: './src/pages/about/main.ts', html: 'about/index.html' },
   * ]
   *
   * // 动态生成
   * entries: async () => {
   *   const pages = await scanPages('./src/pages')
   *   return pages.map(p => ({ entry: p.entry, html: p.output }))
   * }
   * ```
   */
  entries: SSGEntry[] | (() => SSGEntry[] | Promise<SSGEntry[]>);

  /**
   * 自定义渲染函数
   *
   * 接收入口模块的导出对象和原始 HTML 内容，返回渲染后的完整 HTML。
   * 如果不指定，将使用默认的 Vue SSR 渲染逻辑。
   *
   * **默认行为：**
   * 1. 调用模块导出的 `createApp()` 获取 `{ app }`
   * 2. 使用 `vue/server-renderer` 的 `renderToString` 渲染
   * 3. 将 `<div id="app"></div>` 替换为渲染结果
   *
   * @example
   * ```ts
   * // 自定义渲染（例如使用 React）
   * render: async ({ module, html }) => {
   *   const { renderToString } = await import('react-dom/server')
   *   const appHtml = renderToString(module.default())
   *   return {
   *     html: html.replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`)
   *   }
   * }
   *
   * // 自定义 Vue 渲染
   * render: async ({ module, html }) => {
   *   const { renderToString } = await import('vue/server-renderer')
   *   const { app, router } = module.createApp()
   *   await router.isReady()
   *   const appHtml = await renderToString(app)
   *   return {
   *     html: html.replace('<div id="app"></div>', `<div id="app">${appHtml}</div>`)
   *   }
   * }
   * ```
   */
  render?: (context: SSGRenderContext) => Promise<SSGRenderResult>;

  /**
   * 客户端 HTML 中的应用挂载占位标记
   *
   * 仅在使用默认渲染函数时生效。
   *
   * @default '<div id="app"></div>'
   */
  appSelector?: string;

  /**
   * 渲染后注入到容器元素上的属性
   *
   * 仅在使用默认渲染函数时生效。
   *
   * @default 'data-server-rendered="true"'
   */
  serverRenderedAttr?: string;

  /**
   * 入口模块中导出的创建应用函数名
   *
   * 该函数应返回 `{ app: VueApp }` 对象。
   * 仅在使用默认渲染函数时生效。
   *
   * @default 'createApp'
   */
  createAppFn?: string;

  /**
   * SSR 环境的 Vite 配置覆盖
   *
   * 用于配置 SSR 专用的 Vite server（别名、依赖打包策略等）。
   * 将与从 Vite resolvedConfig 中继承的配置合并。
   */
  ssrViteConfig?: UserConfig;

  /**
   * 是否在 SSR 执行前安装浏览器 API Mock（通过 happy-dom）
   *
   * 当 SSR 代码（或依赖的三方库）在模块加载 / setup 阶段访问
   * `window`、`document`、`localStorage` 等 API 时需要开启。
   *
   * 需要安装 `happy-dom` 作为 devDependency。
   *
   * @default true
   */
  mock?: boolean;

  /**
   * 是否启用 SSG
   *
   * @default true
   */
  enabled?: boolean;

  /**
   * 自定义日志前缀
   *
   * @default 'SSG'
   */
  logPrefix?: string;
}

// =====================================================================
// Browser Mock (via happy-dom)
// =====================================================================

let browserMocksInstalled = false;

async function setupBrowserMocks() {
  if (browserMocksInstalled) return;
  browserMocksInstalled = true;

  let Window: any;
  try {
    const happyDom = await import("happy-dom");
    Window = happyDom.Window;
  } catch {
    throw new Error(
      "[vite-plugin-ssg] `mock: true` 需要安装 happy-dom。\n" +
        "请运行: npm install -D happy-dom\n" +
        "或设置 `mock: false` 来禁用浏览器 API Mock。",
    );
  }

  const window = new Window({ url: "http://localhost" });

  // 将 happy-dom Window 实例上的浏览器 API 注入到 globalThis
  const windowKeys = Object.getOwnPropertyNames(window);
  const skipKeys = new Set([
    "undefined",
    "NaN",
    "Infinity",
    "globalThis",
    "global",
    "eval",
    "console",
  ]);

  for (const key of windowKeys) {
    if (skipKeys.has(key) || key in globalThis) continue;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(window, key);
      if (descriptor) {
        Object.defineProperty(globalThis, key, { ...descriptor, configurable: true });
      }
    } catch {
      // 跳过不可读取的属性
    }
  }

  // 关键浏览器 API 必须强制挂载
  const forceKeys = [
    "window",
    "document",
    "navigator",
    "location",
    "localStorage",
    "sessionStorage",
  ] as const;
  for (const key of forceKeys) {
    Object.defineProperty(globalThis, key, {
      value: (window as any)[key],
      writable: true,
      configurable: true,
    });
  }
}

async function defaultVueRender(
  context: SSGRenderContext,
  appSelector: string,
  serverRenderedAttr: string,
  createAppFn: string,
): Promise<SSGRenderResult> {
  const { renderToString } = await import("vue/server-renderer");

  const factory = context.module[createAppFn];
  if (typeof factory !== "function") {
    throw new TypeError(
      `入口模块未导出 "${createAppFn}" 函数。\n` +
        `请确保入口文件包含: export function ${createAppFn}() { return { app } }`,
    );
  }

  const { app } = factory();
  const appHtml = await renderToString(app);

  return {
    html: context.html.replace(appSelector, `<div id="app" ${serverRenderedAttr}>${appHtml}</div>`),
  };
}

/**
 * Vite SSG 插件 — 构建后将 Vue/React 应用预渲染为静态 HTML
 *
 * 在 Vite `closeBundle` 阶段加载指定的入口模块，执行 SSR 渲染，
 * 将渲染结果注入到已构建的 HTML 骨架文件中。
 *
 * @example
 * ```ts
 * // vite.config.ts — 最简用法（Vue 单页应用）
 * import { ssgPlugin } from 'vite-plugin-ssg'
 *
 * export default defineConfig({
 *   plugins: [
 *     ssgPlugin({
 *       entries: [
 *         { entry: './src/main.ts', html: 'index.html' },
 *       ],
 *     }),
 *   ],
 * })
 * ```
 *
 * @example
 * ```ts
 * // vite.config.ts — 多页应用 + 自定义 SSR 配置
 * import { ssgPlugin } from 'vite-plugin-ssg'
 *
 * export default defineConfig({
 *   plugins: [
 *     ssgPlugin({
 *       entries: [
 *         { entry: './src/pages/home/main.ts', html: 'index.html' },
 *         { entry: './src/pages/about/main.ts', html: 'about/index.html' },
 *       ],
 *       ssrViteConfig: {
 *         ssr: { noExternal: ['naive-ui', 'vueuc'] },
 *       },
 *     }),
 *   ],
 * })
 * ```
 *
 * @example
 * ```ts
 * // vite.config.ts — 自定义渲染（React、自定义 Vue 流程等）
 * import { ssgPlugin } from 'vite-plugin-ssg'
 *
 * export default defineConfig({
 *   plugins: [
 *     ssgPlugin({
 *       entries: [{ entry: './src/main.tsx', html: 'index.html' }],
 *       mock: false,
 *       render: async ({ module, html }) => {
 *         const { renderToString } = await import('react-dom/server')
 *         const appHtml = renderToString(module.default())
 *         return {
 *           html: html.replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`),
 *         }
 *       },
 *     }),
 *   ],
 * })
 * ```
 */
export function ssgPlugin(options: SSGPluginOptions): Plugin {
  const {
    render,
    appSelector = '<div id="app"></div>',
    serverRenderedAttr = 'data-server-rendered="true"',
    createAppFn = "createApp",
    mock = true,
    enabled = true,
    logPrefix = "SSG",
  } = options;

  let resolvedConfig: ResolvedConfig;

  return {
    name: "vite-plugin-ssg",
    apply: "build",
    enforce: "post",

    configResolved(config) {
      resolvedConfig = config;
    },

    closeBundle: {
      sequential: true,
      order: "pre",
      async handler() {
        if (!enabled) {
          console.log(`⏭️ [${logPrefix}] 已禁用，跳过预渲染。`);
          return;
        }

        // 1. 解析入口列表
        const entries =
          typeof options.entries === "function" ? await options.entries() : options.entries;

        if (!entries || entries.length === 0) {
          console.warn(`⚠️ [${logPrefix}] 未配置任何入口，跳过预渲染。`);
          return;
        }

        // 2. 计算输出目录
        const projectRoot = resolvedConfig.root;
        const outDir = path.resolve(projectRoot, resolvedConfig.build.outDir);

        // 3. 安装浏览器 Mock
        if (mock) {
          await setupBrowserMocks();
        }

        console.log(`\n🚀 [${logPrefix}] 开始静态预渲染（共 ${entries.length} 个入口）...`);

        // 4. 合并 SSR Vite server 配置
        //    继承用户 Vite 配置中的 alias，与 ssrViteConfig 合并
        const inheritedAlias: Record<string, string> = {};
        const userAlias = resolvedConfig.resolve.alias;
        if (Array.isArray(userAlias)) {
          for (const item of userAlias) {
            if (typeof item.find === "string") {
              inheritedAlias[item.find] = item.replacement;
            }
          }
        }

        const ssrServerConfig: InlineConfig = {
          // 使用原始配置文件路径确保 SSR server 能加载 vue 等插件
          configFile: resolvedConfig.configFile,
          // root 使用 vite.config.ts 所在目录（而非 resolvedConfig.root），
          // 因为用户可能设置了 root: 'html' 等子目录，
          // 而 auto-import 等插件的相对路径基于 configFile 所在目录解析
          root: resolvedConfig.configFile ? path.dirname(resolvedConfig.configFile) : projectRoot,
          // 继承开发/构建模式，确保插件逻辑一致性
          mode: resolvedConfig.mode,
          // 继承环境配置，确保 SSR 服务加载相同的 .env 文件
          envDir: resolvedConfig.envDir,
          envPrefix: resolvedConfig.envPrefix,
          server: { middlewareMode: true },
          appType: "custom",
          // 合并用户的 ssrViteConfig（但 resolve.alias 需特殊合并）
          ...options.ssrViteConfig,
          resolve: {
            ...options.ssrViteConfig?.resolve,
            alias: {
              ...inheritedAlias,
              ...(options.ssrViteConfig?.resolve?.alias as Record<string, string>),
            },
          },
        };

        const vite = await createServer(ssrServerConfig);

        // 5. 逐个渲染入口
        let successCount = 0;
        let failCount = 0;

        for (const entry of entries) {
          const htmlPath = path.resolve(outDir, entry.html);

          try {
            // 检查 HTML 文件是否存在
            const htmlContent = await fs.readFile(htmlPath, "utf8");

            // 加载 SSR 入口模块
            const ssrModule = await vite.ssrLoadModule(entry.entry);

            // 执行渲染
            let result: SSGRenderResult;

            if (render) {
              // 使用自定义渲染函数
              result = await render({
                module: ssrModule,
                entry,
                html: htmlContent,
              });
            } else {
              // 使用默认 Vue 渲染
              result = await defaultVueRender(
                { module: ssrModule, entry, html: htmlContent },
                appSelector,
                serverRenderedAttr,
                createAppFn,
              );
            }

            await fs.writeFile(htmlPath, result.html, "utf8");

            const displayPath = path.relative(outDir, htmlPath);
            console.log(`   ✅ ${displayPath}`);
            successCount++;
          } catch (err: any) {
            failCount++;
            console.error(`   ❌ ${entry.html}`);
            console.error(`      ${err.message || err}`);
          }
        }

        // 6. 关闭 SSR 服务
        await vite.close();

        const status = failCount > 0 ? "⚠️" : "🎉";
        console.log(
          `\n${status} [${logPrefix}] 预渲染完成！成功 ${successCount}，失败 ${failCount}。\n`,
        );
      },
    },
  };
}
