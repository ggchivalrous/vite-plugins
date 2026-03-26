# vite-plugin-ssg 重构总结

## 设计理念

将项目内部的 SSG 脚本重构为**可独立发布的通用 Vite 插件**，核心原则：

1. **零项目假设** — 不假设任何目录结构（`.generated`、`html` 子目录等）
2. **框架无关** — 默认支持 Vue，但通过 `render` 回调可用于 React、Solid 等任何框架
3. **显式优于隐式** — 用户声明 `entries` 列表，而非扫描某个约定目录
4. **配置继承** — 自动从 Vite `resolvedConfig` 中继承 `root`、`outDir`、`alias`

## API 概览

### 核心选项

| 选项             | 类型                               | 说明                                         |
| ---------------- | ---------------------------------- | -------------------------------------------- |
| `entries` ⚡必填 | `SSGEntry[]` \| `() => SSGEntry[]` | 需要预渲染的页面列表                         |
| `render`         | `(ctx) => { html }`                | 自定义渲染函数（默认 Vue SSR）               |
| `ssrViteConfig`  | `UserConfig`                       | SSR 服务器的 Vite 配置覆盖                   |
| `mock`           | `boolean`                          | 是否安装 happy-dom Mock（默认 `true`）       |
| `appSelector`    | `string`                           | HTML 占位标记（默认 `<div id="app"></div>`） |
| `createAppFn`    | `string`                           | 入口导出函数名（默认 `createApp`）           |
| `enabled`        | `boolean`                          | 是否启用（默认 `true`）                      |

### `SSGEntry` 结构

```ts
interface SSGEntry {
  entry: string; // SSR 入口模块路径（供 vite.ssrLoadModule 加载）
  html: string; // 输出 HTML 路径（相对于 build.outDir）
}
```

## 使用示例

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

## 项目内适配

你的项目通过 `entries` 回调 + `toolsConfig` 动态生成入口列表：

```ts
ssgPlugin({
  entries: () => {
    const result = [];
    for (const config of toolsConfig) {
      // ... 从 MPA 配置中构建 SSGEntry 列表
      result.push({
        entry: `/.generated/${outputDir}/main.ts`,
        html: `${outputDir}/index.html`,
      });
    }
    return result;
  },
  ssrViteConfig: {
    ssr: { noExternal: ["naive-ui", "vueuc", "date-fns"] },
    resolve: { alias: { "/.generated": "..." } },
  },
});
```

> [!NOTE]
> 所有 `.generated` 目录、`naive-ui` 等项目特定信息现在都由**使用方**配置传入，插件本身不包含任何项目假设。

## 涉及文件

| 文件                                                                                                | 变更                             |
| --------------------------------------------------------------------------------------------------- | -------------------------------- |
| [vite-plugin-ssg.ts](file:///Users/emt/custom/tools-web/app/tools-website/build/vite-plugin-ssg.ts) | 通用 SSG 插件（可发布为 npm 包） |
| [vite-plugin.ts](file:///Users/emt/custom/tools-web/app/tools-website/build/vite-plugin.ts)         | 项目中的使用示例                 |
| [pnpm-workspace.yaml](file:///Users/emt/custom/tools-web/pnpm-workspace.yaml)                       | 添加 happy-dom 到 build catalog  |
| [package.json](file:///Users/emt/custom/tools-web/app/tools-website/package.json)                   | 添加 happy-dom 依赖引用          |
| [scripts/ssg.ts](file:///Users/emt/custom/tools-web/app/tools-website/scripts/ssg.ts)               | ⚠️ 可安全删除                    |
