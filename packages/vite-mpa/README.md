# vite-plugin-mpa

一款强大且灵活的 Vite 多页应用（MPA）构建与入口生成插件。它可以根据简单配置，自动为你生成各类页面的 HTML、入口 `main.ts` 及其对应的挂载应用组件 `app.vue`，并将虚拟文件映射给本地服务器，极大地简化了 Vite MPA 的繁琐配置。

## 特性

- 🚀 自动生成 HTML 与多页入口，内置美观默认模板。
- 🔍 强大的目录扫描规则，支持按文件夹分散配置。
- ⚙️ 支持自定义全局 HTML、入口与应用模板，提供丰富的占位符宏。
- 🛠️ 支持页面独立的 Title, Meta 标签与 Favicon 定制。
- ⚡ 完美融入 Vite dev-server 路由代理与生产环境 Rollup 产物归类。

## 安装

无需手动安装第三方依赖，直接装在你的项目中：

```bash
npm i @ggcv/vite-plugin-mpa -D
# 或是 pnpm
pnpm i @ggcv/vite-plugin-mpa -D
```

## 使用方法

在你的 `vite.config.ts` 中引入插件并配置：

```typescript
import { defineConfig } from "vite";
import { mpaPlugin } from "@ggcv/vite-plugin-mpa";

export default defineConfig({
  plugins: [
    mpaPlugin({
      // 你可以在这里直接传入配置数组
      config: [
        { page: "home", title: "首页", output: "index" },
        { page: "admin", title: "后台系统" },
      ],
    }),
  ],
});
```

有了以上配置后，访问 `http://localhost:5173/` （根路径）将自动加载 `src/pages/home/index.vue`。
访问 `http://localhost:5173/admin` 会自动加载 `src/pages/admin/index.vue`。

---

## 动态参数宏 (Macros)

插件允许你提供自己的模板文件（通过 `options.template`、`options.appTemplate` 配置）。在模板解析过程中，系统会替换特定的参数宏。

### 1. HTML 模板支持的宏 (`options.template`)

如果你在根目录下编写了自己的 `.html` 模板，可在模板中使用以下占位符：

| 宏占位符          | 说明                                                                             |
| :---------------- | :------------------------------------------------------------------------------- |
| `%TITLE%`         | 会被替换为该页面配置的 `title` 内容。                                            |
| `%VITE_APP_NAME%` | `%TITLE%` 的别名，用于向后兼容旧项目的模板书写习惯。                             |
| `%META%`          | 会被替换为页面配置中 `metas` 数组解析出来的标准化 `<meta>` 标签块。              |
| `%FAVICON%`       | 会被替换为该页面的 favicon 路径（默认自动推导，或可由配置的 `favicon` 值覆盖）。 |
| `%ENTRY%`         | **必填**，会被替换为对应页面实际生成的 `main.ts` 文件的相对路径地址。            |

**HTML 模板示例：**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="%FAVICON%" />
    %META%
    <title>%TITLE%</title>
  </head>
  <body>
    <div id="app"></div>
    <!-- 这里必须要有，否则 Vite 没法加载入口 -->
    <script type="module" src="%ENTRY%"></script>
  </body>
</html>
```

### 2. Vue 应用入口层支持的宏 (`options.appTemplate`)

在覆盖应用挂载的模板时（生成最终的 `app.vue` 外壳）：

| 宏占位符   | 说明                                                                                     |
| :--------- | :--------------------------------------------------------------------------------------- |
| `// @Page` | 会被准确替换为经过解析的（如绝对路径的）视图层组件 `import Page from '...'` 的引入语句。 |

---

## 配置与扫描规则

本插件在读取 MPA 页面配置时非常灵活，支持多种配置组合或分散管理方式。它的读取优先级规则按照以下流转：

### 1. 直接传递配置数组 (Direct Config Array)

如果你希望所有的多页入口能集中管理，这可以直接传给 `options.config` 数组：

```typescript
mpaPlugin({
  config: [
    { page: "page1", title: "页面1" },
    { page: "page2", title: "页面2", appEntry: ["index", "detail"] },
  ],
});
```

### 2. 传递指定的配置文件路径 (Config File Path)

如果你希望把配置与 `vite.config.ts` 分开，你可以用字符串告诉插件去哪里加载配置：

```typescript
mpaPlugin({
  config: "./config/mpa.config.ts",
});
```

该文件必须 `export default` 一个 `Config` 数组或单个对象。推荐使用插件自带的 `defineMpaConfig` 包裹，它自带类型推导。

### 3. 指定目录树的递归扫描 (Scan Directory)

（**大型 MPA 项目推荐的方案**）
如果你没有传递 `options.config`，而是想让不同的页面各自管理自己的配置：你可以配置 `options.scanDir`。

```typescript
mpaPlugin({
  scanDir: "src/pages", // 默认从这个目录开始寻找
});
```

**扫描规则：**

1. 插件会**深度递归遍历**你指定的 `scanDir`。
2. 在该目录下，只要匹配到目标文件名（可通过 `options.scanFile` 参数指定，也可以是数组），就会解析并收集这些文件的配置。
3. 如果未手动指定 `options.scanFile`，默认将匹配以下四种文件名：
   - `mpa.config.ts`
   - `mpa.config.js`
   - `mpa.config.mjs`
   - `mpa.config.cjs`
4. 将所有扫描到的文件内容执行合并。

_参考目录结构：_

```text
src/pages/
├── home/
│   ├── index.vue
│   └── mpa.config.ts   // 配置导出：{ page: 'home', title: '首页' }
└── auth/
    ├── index.vue
    └── mpa.config.ts   // 配置导出：{ page: 'auth', title: '鉴权页' }
```

通过开启 `scanDir` 服务，各目录的独立页面配置互不打扰而且一目了然。

### 4. 根目录兜底自动查找 (Fallback)

如果以上三种（`config 直接传递`、`config 字符串路径`、`scanDir`）你一样都没有配置，插件会默默在你提供的 `baseDir`（如果不传就是所在项目的根目录）去尝试寻找默认配置入口文件（也就是上面列举出的四个 `mpa.config.[ext]`）。

---

## 页面配置详解 (`Config`)

每一个页面的单独入口配置具备极高的定制上限：

| 属性        | 类型                 | 说明                                                                                                                                                                                                                                                                                                                                                       |
| :---------- | :------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page`      | `string`             | **必填**。相对于 `pagesDir` 的子目录名，同时也是 url path 基础输出。 （如填 `'auth'` => 查找 `src/pages/auth/index.vue` ）                                                                                                                                                                                                                                 |
| `title`     | `string`             | **必填**。此页面 `<title>` 和 `%TITLE%` 宏注入的文案。                                                                                                                                                                                                                                                                                                     |
| `component` | `string`             | 选填。强行指定页面所使用的 .vue 组件库路径，如果存在就完全无视 `pagesDir` 与 `page` 的路径拼接策略。                                                                                                                                                                                                                                                       |
| `sourceDir` | `string`             | 选填。给这个页面配置强制重定向的一个独立根工作目录。                                                                                                                                                                                                                                                                                                       |
| `appEntry`  | `string \| string[]` | 选填。默认为 `'index'`，如果你希望这一个 `page` 目录下生成多个页面（如 `mobile.html` 和 `desktop.html`），可以配置 `['mobile', 'desktop']` 且提供对应的 vue 源码对应文件名即可。                                                                                                                                                                           |
| `output`    | `string`             | 选填。它通常用于将如 `page: 'home'` 这样的主页名字覆盖指定为 `'index'`，也就是让打包后的该页 HTML 输出在最层根目录（`dist/index.html`），配合路由 `/` 即可完成主页跳转。<br/>_(注：如果当前页面有多入口 `appEntry`，`output: 'index'` 专属的路由重定向覆盖只会对 `'index'` 默认入口生效，其他子页面比如 `'about'` 不受其干扰，依然输出在自己的归属目录下)_ |
| `favicon`   | `string`             | 选填。此页面的 favicon 图标绝对路径。                                                                                                                                                                                                                                                                                                                      |
| `metas`     | `MetaTag[]`          | 选填。专门用于为页面提供定制化的 `<meta>` 参数数组。                                                                                                                                                                                                                                                                                                       |

### `defineMpaConfig` 的使用

插件内导出该函数可提供极佳的 IDE 编写体验：

```typescript
// src/pages/user/mpa.config.ts
import { defineMpaConfig } from "@ggcv/vite-plugin-mpa";

export default defineMpaConfig({
  page: "user",
  title: "个人中心",
  metas: [{ name: "description", content: "个人账号配置模块" }],
});
```
