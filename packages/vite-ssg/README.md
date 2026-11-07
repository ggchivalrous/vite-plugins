# vite-plugin-ssg

## 起因

> 由于作者在vite项目中弄了一个多入口的MPA多页应用，每个页面都需要SSG渲染
>
> 使用 **vite-ssg** 包进行SSG时发现这个包似乎对多入口的应用不起作用，所以请 Ai 设计了这么一个Vite SSG插件

## 设计理念

核心原则：

1. **零项目假设** — 不假设任何目录结构（`.generated`、`html` 子目录等）
2. **框架无关** — 默认支持 Vue，但通过 `render` 回调可用于 React、Solid 等任何框架
3. **显式优于隐式** — 用户声明 `entries` 列表，而非扫描某个约定目录
4. **配置继承** — 自动从 Vite `resolvedConfig` 中继承 `root`、`outDir`、`alias`
5. **无需SSR判断** — 内部自带浏览器环境mock，虽然不保证百分百覆盖，但能减少非常多的SSR环境判断

## API 概览

### 核心选项

| 选项             | 类型                               | 说明                                         |
| ---------------- | ---------------------------------- | -------------------------------------------- |
| `entries` ⚡必填 | `SSGEntry[]` \| `() => SSGEntry[]` | 需要预渲染的页面列表                         |
| `render`         | `(ctx) => { html }`                | 自定义渲染函数（默认 Vue SSR）               |
| `ssrViteConfig`  | `UserConfig`                       | 生产 SSR 构建的 Vite 配置覆盖                |
| `mock`           | `boolean`                          | 是否安装 happy-dom Mock（默认 `true`）       |
| `appSelector`    | `string`                           | HTML 占位标记（默认 `<div id="app"></div>`） |
| `createAppFn`    | `string`                           | 入口导出函数名（默认 `createApp`）           |
| `enabled`        | `boolean`                          | 是否启用（默认 `true`）                      |

### `SSGEntry` 结构

```ts
interface SSGEntry {
  entry: string; // SSR 入口模块路径（构建后加载，支持相对路径和 alias）
  html: string; // 输出 HTML 路径（相对于 build.outDir）
}
```

## 使用示例

### 生产资源处理

插件在客户端构建完成后，额外构建 SSR 入口，并使用生产模块生成静态 HTML。
图片等资源由 Vite 统一处理 hash、内联和 `public` 地址，无需开启 `build.manifest`，
也无需通过自定义 `render` 替换源码资源地址。自定义 `render` 同样接收生产模块。

自动继承 `base`、资源输出规则及环境配置。`base: './'` 或 `base: ''` 时，
导入资源的 URL 按每个输出 HTML 的目录计算，支持首页和嵌套页面。
SSR 分支独有的资源也会写入站点输出目录。临时 SSR 模块在结束后删除；
入口构建或页面渲染失败会使整个构建失败。

`ssrViteConfig` 现在用于覆盖生产 SSR 构建配置；仅开发服务器使用的配置不再参与预渲染。
插件自动管理 SSR 入口、临时输出目录和 ESM 模块格式。

### Vue 单页应用（最简）

```ts
ssgPlugin({
  entries: [{ entry: "./src/main.ts", html: "index.html" }],
});
```

### Vue 多页应用

```ts
ssgPlugin({
  entries: [
    { entry: "./src/pages/home/main.ts", html: "index.html" },
    { entry: "./src/pages/about/main.ts", html: "about/index.html" },
  ],
  ssrViteConfig: {
    ssr: { noExternal: ["naive-ui"] },
  },
});
```

### 动态生成入口

```ts
ssgPlugin({
  entries: async () => {
    const pages = await scanPages("./src/pages");
    return pages.map((p) => ({ entry: p.entry, html: p.output }));
  },
});
```

### 自定义渲染（React）

```ts
ssgPlugin({
  entries: [{ entry: "./src/main.tsx", html: "index.html" }],
  mock: false,
  render: async ({ module, html }) => {
    const { renderToString } = await import("react-dom/server");
    const appHtml = renderToString(module.default());
    return {
      html: html.replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`),
    };
  },
});
```
