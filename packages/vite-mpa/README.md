# vite-plugin-mpa

一款强大且灵活的 Vite 多页应用（MPA）构建与入口生成插件。它可以根据配置自动生成各页面的 HTML、入口 `main.ts` 及其挂载组件 `app.vue`。

插件核心解决了 MPA 开发中的痛点：通过虚拟化/自动生成技术，让开发者只需关注业务组件，而无需手动维护繁琐的 HTML 入口文件。

## ✨ 特性

- 🚀 **自动化入口生成**：自动生成 HTML、入口脚本与 Vue 挂载外壳，无需手动维护。
- 📦 **构建产物零污染**：通过 `.generated` 隔离带进行构建，最终物理产物平铺在 `dist` 根部，干净整洁。
- 🔍 **灵活的扫描规则**：支持全量配置、独立配置文件或按文件夹递归扫描。
- ⚙️ **精细化模板定制**：提供全局及**页面级**的 HTML/App/Main 模板覆盖，支持丰富的宏替换。
- 🛠️ **完善的 SEO 支持**：支持页面独立的 Title、Meta 标签与 Favicon 定制。
- ⚡ **深度集成**：完美支持 Vite Dev Server 路由改写、Preview Server 以及 **SSG (静态站点生成)**。

## 📦 安装

```bash
npm i @ggcv/vite-plugin-mpa -D
# 或
pnpm i @ggcv/vite-plugin-mpa -D
```

## 🚀 使用方法

### 基础配置

在 `vite.config.ts` 中引入：

```typescript
import { defineConfig } from "vite";
import { mpaPlugin } from "@ggcv/vite-plugin-mpa";

export default defineConfig({
  plugins: [
    mpaPlugin({
      config: [
        { page: "home", title: "首页", output: "index" },
        { page: "about", title: "关于我们" },
      ],
    }),
  ],
});
```

- 访问 `/`：加载 `src/pages/home/index.vue`
- 访问 `/about` : 加载 `src/pages/about/index.vue`

---

## 🏗️ 构建逻辑说明

与传统的 MPA 插件不同，本插件采用“**隔离构建，最终平铺**”的策略：

1. **构建中**：所有生成的临时 HTML 存放在 `.generated/` 目录中。
2. **路径修复**：插件会自动解析注入的 JS/CSS 资源路径，确保它们与最终平铺后的位置匹配。
3. **构建后**：将产物从 `.generated/` 物理移动到 `dist/` 根目录。

这意味着你的 `dist` 目录结构将非常直观，不再被工具链生成的临时目录所干扰。

---

## 🌈 SSG (静态站点生成) 支持

本插件与 `vite-plugin-ssg` 深度兼容。通过导出的 `resolveMpaEntries` 工具函数，你可以轻松实现全自动的 MPA 预渲染。

```typescript
import { defineConfig } from "vite";
import { mpaPlugin, resolveMpaEntries } from "@ggcv/vite-plugin-mpa";
import { ssgPlugin } from "@ggcv/vite-plugin-ssg";

export default defineConfig(async (env) => {
  const mpaOptions = {
    config: [
      /* ... */
    ],
  };

  return {
    plugins: [
      mpaPlugin(mpaOptions),
      ssgPlugin({
        // 自动解析 MPA 生成的所有入口，供 SSG 插件抓取并渲染
        entries: await resolveMpaEntries(mpaOptions, env),
      }),
    ],
  };
});
```

---

## 📝 模板参数宏 (Macros)

可以在自定义模板中使用以下占位符，插件会在生成时自动填充：

### HTML 模板宏

| 宏占位符          | 说明                                             |
| :---------------- | :----------------------------------------------- |
| `%TITLE%`         | 页面标题。                                       |
| `%META%`          | 自动生成的 `<meta>` 标签块。                     |
| `%FAVICON%`       | 页面的 favicon 引用路径。                        |
| `%ENTRY%`         | **必填**。会被替换为绝对路径指向生成的入口脚本。 |
| `%VITE_APP_NAME%` | `%TITLE%` 的别名。                               |

### Vue 挂载模板宏

| 宏占位符   | 说明                                 |
| :--------- | :----------------------------------- |
| `// @Page` | 会被替换为业务组件的 `import` 语句。 |

---

## ⚙️ 配置项详解

### 插件选项 (`ViteMpaOptions`)

| 属性           | 类型                 | 默认值         | 说明                           |
| :------------- | :------------------- | :------------- | :----------------------------- |
| `config`       | `Config[] \| string` | -              | 页面配置数组或配置文件路径。   |
| `scanDir`      | `string`             | `'src/pages'`  | 自动扫描配置的起始目录。       |
| `pagesDir`     | `string`             | `'src/pages'`  | 业务 `.vue` 组件存放的根目录。 |
| `generatedDir` | `string`             | `'.generated'` | 存放临时生成代码的目录名。     |
| `template`     | `string`             | -              | 全局 HTML 模板路径。           |
| `appTemplate`  | `string`             | -              | 全局 `app.vue` 挂载模板路径。  |
| `verbose`      | `boolean`            | `false`        | 是否开启详细控制台日志。       |

### 页面配置 (`Config`)

| 属性          | 类型                 | 说明                                                   |
| :------------ | :------------------- | :----------------------------------------------------- |
| `page`        | `string`             | **必填**。相对于 `pagesDir` 的子目录名，决定路由路径。 |
| `title`       | `string`             | **必填**。页面标题。                                   |
| `output`      | `string`             | 选填。指定输出文件名（如 `'index'` 会输出到根目录）。  |
| `appEntry`    | `string \| string[]` | 选填。指定目录下的入口名，支持单目录多页。             |
| `metas`       | `MetaTag[]`          | 选填。定制该页面的 Meta 标签。                         |
| `template`    | `string`             | 选填。**页面级** HTML 模板，优先级高于全局设置。       |
| `appTemplate` | `string`             | 选填。**页面级** App 模板，优先级高于全局设置。        |
| `component`   | `string`             | 选填。强行指定业务组件路径（跳过自动匹配）。           |

---

## 🛠️ 推荐目录结构

```text
.
├── src/
│   └── pages/
│       ├── home/
│       │   ├── index.vue
│       │   └── mpa.config.ts  // 该页面的独立配置
│       └── about/
│           └── index.vue      // 也可以由全局配置统一管理
├── mpa.config.ts              // 全量配置文件（可选）
└── vite.config.ts
```

使用 `defineMpaConfig` 获得全量类型提示：

```typescript
import { defineMpaConfig } from "@ggcv/vite-plugin-mpa";

export default defineMpaConfig({
  page: "home",
  title: "Vite MPA App",
});
```

## 📄 License

[MIT](./LICENSE) License © 2026-PRESENT [ggchivalrous](https://github.com/ggchivalrous).
