/* eslint-env browser */
import { createApp as initApp } from "./app";
import { createApp } from "vue";
import NProgress from "./components/NProgress.vue";

const { app } = initApp();

const progressBar = createApp(NProgress).mount(document.createElement("div"));
app.config.globalProperties.$progressBar = progressBar;
document.body.appendChild(progressBar.$el);

app.mount("#app");
