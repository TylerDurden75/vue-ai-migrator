/* eslint-env browser */
import { createApp } from "vue";
import "es6-promise/auto";
import { createApp as createAppFactory } from "./app";
import ProgressBar from "./components/ProgressBar.vue";

const { app } = createAppFactory();

// global progress bar - BROKEN: createApp(ProgressBar).mount() instead of createApp(ProgressBar).mount()
const bar = createApp(ProgressBar).mount(document.createElement("div"));
app.config.globalProperties.$bar = bar;
document.body.appendChild(bar.$el);

// a global mixin
app.mixin({
  beforeRouteUpdate(to, from, next) {
    next();
  },
});

app.mount("#app");
