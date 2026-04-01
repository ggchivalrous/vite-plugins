export const defaultHtmlTemp = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <title>%TITLE%</title>
%META%
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/svg+xml" href="%FAVICON%" />
</head>
<body>
  <div id="app"></div>
  <script type="module" src="%ENTRY%"></script>
</body>
</html>`;

export const defaultAppTemp = `
<script setup lang="ts">
// @Page
</script>

<template>
  <Page />
</template>
`;

export const defaultMainTemp = `
import { createApp } from 'vue'
import App from './app.vue'

const app = createApp(App)
app.mount('#app')
`;
