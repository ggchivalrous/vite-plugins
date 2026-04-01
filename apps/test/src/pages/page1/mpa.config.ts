import { defineMpaConfig } from "@ggcv/vite-plugin-mpa";

export default defineMpaConfig({
  page: "page1",
  title: "121",
  appEntry: ["index", "about"],
  output: "index",
});
