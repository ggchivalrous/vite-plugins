/**
 * HTML `<meta>` 标签的属性对象。键值对将被渲染为 meta 标签的属性。
 *
 * @example
 * // 渲染为 <meta name="description" content="..." />
 * { name: 'description', content: '页面描述' }
 *
 * @example
 * // 渲染为 <meta http-equiv="X-UA-Compatible" content="IE=edge" />
 * { 'http-equiv': 'X-UA-Compatible', content: 'IE=edge' }
 */
export type MetaTag = Record<string, string>;

export interface Config {
  /**
   * 相对于 pages 目录的页面子目录名，用于定位页面组件文件。
   * 例如 `'tools/my-tool'`，则会找 `pages/tools/my-tool/index.vue`。
   */
  page: string;

  /**
   * 页面标题，注入到 HTML `<title>` 标签中。
   */
  title: string;

  /**
   * 页面入口文件名（不需要 .vue 后缀）。
   * 可以是字符串或字符串数组（用于一个 page 目录对应多个子入口）。
   * @default 'index'
   */
  appEntry?: string | string[];

  /**
   * HTML 输出路径名，覆盖默认的 `page` 值。
   * 例如设置为 `'index'`，则输出到 `htmlDir/index.html`，可实现根路径访问。
   * 仅当 `appEntry` 为单个值（默认 `'index'`）时生效。
   */
  output?: string;

  /**
   * 页面的 favicon 路径（建议使用绝对路径或 `/` 开头的相对路径）。
   * 若不设置，默认生成 `/{outputDir}.svg`。
   */
  favicon?: string;

  /**
   * 注入 HTML `<head>` 的 meta 标签列表。
   * 每个对象的键值对对应 meta 标签的属性。
   *
   * @example
   * [
   *   { name: 'description', content: '页面描述' },
   *   { name: 'keywords', content: 'vite, mpa, plugin' },
   *   { 'http-equiv': 'X-UA-Compatible', content: 'IE=edge' },
   * ]
   */
  metas?: MetaTag[];
}

export interface ViteMpaOptions {
  /**
   * 页面配置。
   * - 传入 `Config[]` 数组：直接使用该配置。
   * - 传入配置文件路径字符串（如 `'./mpa.config.ts'`）：从文件加载。
   * - 不传入：依次尝试 `scanDir` 扫描 → 在 `baseDir` 查找默认配置文件。
   */
  config?: Config[] | string;

  /**
   * 扫描多页配置的目录（当未通过 `toolsConfig` 指定全量配置时生效）。
   * 会在该目录下递归扫描指定文件并聚合为完整配置。
   * @example 'src/pages'
   */
  scanDir?: string;

  /**
   * 配合 `scanDir` 使用，指定被扫描的配置文件名称。
   * @default 'vite-mpa.ts'
   */
  scanFile?: string;

  /**
   * 查找默认配置文件时的基础目录（寻找 `mpa.config.ts` 等文件时使用）。
   * 默认为 Vite 的 `root` 目录。
   */
  baseDir?: string;

  /**
   * HTML 模板文件路径（绝对路径或相对于 Vite root 的相对路径）。
   * 模板中可使用以下占位符：
   * - `%TITLE%`：页面标题
   * - `%META%`：注入的 meta 标签块
   * - `%FAVICON%`：favicon 路径
   * - `%ENTRY%`：入口脚本相对路径
   *
   * 若不指定，将使用内置默认模板。
   */
  template?: string;

  /**
   * 生成的入口代码输出目录（相对于 Vite root 或绝对路径）。
   * @default '.generated'
   */
  generatedDir?: string;

  /**
   * 自定义 `app.vue` 模板文件路径（相对于 Vite root 或绝对路径）。
   * 模板中可使用以下占位符：
   * - `// @Page`：会被替换为页面组件导入语句
   * - `// @Main`：会被替换为 AppMain 组件导入语句
   */
  appTemplate?: string;

  /**
   * 自定义 `main.ts` 模板文件路径（相对于 Vite root 或绝对路径）。
   */
  mainTemplate?: string;

  /**
   * 是否启用详细日志输出，包括每个生成文件的路径。
   * @default false
   */
  verbose?: boolean;
}
