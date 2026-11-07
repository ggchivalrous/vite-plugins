import type { Plugin, ResolvedConfig, UserConfig } from "vite";
import type { SSGEntry } from "./index";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build, mergeConfig, normalizePath } from "vite";

/**
 * 使用生产构建处理资源、SSR 条件和入口导出，避免将开发态 URL 写入静态页面。
 */
export async function buildRenderer(
  config: ResolvedConfig,
  entries: SSGEntry[],
  overrides: UserConfig = {},
) {
  const tempDir = await fs.mkdtemp(path.join(config.root, ".vite-ssg-"));
  const input = Object.fromEntries(
    entries.map((_, index) => [`page-${index}`, `virtual:ssg-${index}`]),
  );
  const relativeUrls = new Map<string, string>();
  const assets = new Map<string, string | Uint8Array>();
  const entryIds = new Map<number, string>();
  const moduleFiles = new Map<number, string>();
  const inlineConfig = mergeConfig(config.inlineConfig, overrides);
  // Vite 会原地补充客户端 environment，不能将它再次传给 SSR 构建。
  inlineConfig.environments = overrides.environments;

  const entryPlugin: Plugin = {
    name: "vite-plugin-ssg:build",
    enforce: "post",
    config: {
      order: "post",
      handler(ssrConfig) {
        // MPA 插件也可能添加 HTML 入口。SSR 构建只保留显式声明的脚本入口。
        const output = ssrConfig.build?.rollupOptions?.output;
        const assetFileNames = Array.isArray(output)
          ? output[0]?.assetFileNames
          : output?.assetFileNames;
        const buildOptions = { ...ssrConfig.build };
        delete buildOptions.rolldownOptions;
        ssrConfig.build = {
          ...buildOptions,
          ssr: true,
          outDir: tempDir,
          emptyOutDir: true,
          write: true,
          watch: null,
          lib: false,
          manifest: false,
          ssrManifest: false,
          copyPublicDir: false,
          ssrEmitAssets: true,
          minify: false,
          rollupOptions: {
            ...ssrConfig.build?.rollupOptions,
            input,
            preserveEntrySignatures: "strict",
            output: {
              format: "es",
              entryFileNames: "[name].mjs",
              chunkFileNames: "chunks/[name]-[hash].mjs",
              assetFileNames,
            },
          },
        };

        // 相对 base 的资源地址依赖最终 HTML 所在目录，而非临时 SSR 模块目录。
        const renderBuiltUrl = ssrConfig.experimental?.renderBuiltUrl;
        ssrConfig.experimental = {
          ...ssrConfig.experimental,
          renderBuiltUrl(filename, context) {
            const result = renderBuiltUrl?.(filename, context);
            if (typeof result === "string" || result?.runtime) return result;

            const relative = result?.relative ?? (config.base === "./" || config.base === "");
            if (!relative || !context.ssr) return result;

            const token = `__SSG_RELATIVE_ASSET_${relativeUrls.size}__`;
            relativeUrls.set(token, filename);
            return token;
          },
        };
      },
    },
    async resolveId(id) {
      const index = Object.values(input).indexOf(id);
      if (index < 0) return;

      const entry = entries[index]!.entry;
      const resolved = await this.resolve(entry, path.join(config.root, "index.html"), {
        skipSelf: true,
      });
      if (resolved) entryIds.set(index, resolved.id);
      return resolved;
    },
    generateBundle(_, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type === "asset") assets.set(item.fileName, item.source);
        else if (item.isEntry) {
          for (const [index, id] of entryIds) {
            if (item.facadeModuleId === id) moduleFiles.set(index, item.fileName);
          }
        }
      }
    },
  };

  try {
    await build({
      ...inlineConfig,
      configFile: config.configFile || false,
      root: config.root,
      base: config.base,
      mode: config.mode,
      envDir: config.envDir,
      envPrefix: config.envPrefix,
      logLevel: config.logLevel,
      plugins: [overrides.plugins ?? config.inlineConfig.plugins, entryPlugin],
      build: { ...inlineConfig.build, ssr: true, outDir: tempDir },
    });

    // SSR 分支独有的资源也必须随站点发布；客户端产物不会被清空。
    for (const [filename, source] of assets) {
      const destination = path.resolve(config.root, config.build.outDir, filename);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, source);
    }
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }

  return {
    loadModule(index: number): Promise<Record<string, any>> {
      const filename = moduleFiles.get(index);
      if (!filename) throw new Error(`未生成 SSR 入口: ${entries[index]?.entry}`);
      return import(pathToFileURL(path.join(tempDir, filename)).href);
    },
    resolveHtml(html: string, entry: SSGEntry) {
      for (const [token, filename] of relativeUrls) {
        const relative = normalizePath(path.relative(path.dirname(entry.html), filename));
        html = html.replaceAll(token, relative.startsWith(".") ? relative : `./${relative}`);
      }
      return html;
    },
    close() {
      return fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}
