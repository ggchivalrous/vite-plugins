import { createSSRApp, h } from "vue";
import image from "./image.svg?no-inline";
import inlineImage from "./inline.svg";
import publicImage from "/public.svg";

export function createApp() {
  return {
    app: createSSRApp({
      render: () =>
        h("main", [
          h("img", { id: "hashed", src: image }),
          h("img", { id: "inline", src: inlineImage }),
          h("img", { id: "public", src: publicImage }),
          h("img", { id: "srcset", srcset: `${image} 1x, ${image} 2x` }),
          h("div", { id: "background", style: { backgroundImage: `url(${image})` } }),
          h("p", { id: "base" }, import.meta.env.BASE_URL),
        ]),
    }),
  };
}

if (!import.meta.env.SSR) createApp().app.mount("#app");
