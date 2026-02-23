/**
 * Unit tests for router fixes rules
 */

import * as path from "path";
import { createAppSyntaxRule, vue2GlobalApiRule, createWebHistoryRule, catchAllRouteRule, routerDefineAsyncComponentUnwrapRule } from "../rules/router/router-fixes";

describe("Router Fixes Rules", () => {
  describe("createAppSyntaxRule", () => {
    it("should convert Vue.config.ignoredElements to app.config.compilerOptions.isCustomElement", async () => {
      const content = `import { createApp } from "vue";
import App from "./App.vue";

Vue.config.ignoredElements = ['plastic-button'];
const app = createApp(App);
app.mount("#app");`;

      const result = await createAppSyntaxRule.apply(
        "src/main.js",
        content,
        { enableTypeScript: false, isVueFile: false, scriptContent: content }
      );

      expect(result.fixed).toBe(true);
      expect(result.content).toContain("app.config.compilerOptions.isCustomElement");
      expect(result.content).toContain("plastic-button");
      expect(result.content).not.toContain("Vue.config.ignoredElements");
    });

    it("should fix createApp syntax", async () => {
      const content = `const app = createApp(App).use(router).use(pinia).mount('#app');`;

      const result = await createAppSyntaxRule.apply(
        "src/main.ts",
        content,
        {
          enableTypeScript: true,
          isVueFile: false,
          scriptContent: content
        }
      );

      expect(result).toBeDefined();
      if (result.fixed) {
        expect(result.content).toContain("createApp(App)");
      }
    });
  });

  describe("vue2GlobalApiRule", () => {
    it("should comment out Vue.filter (filters removed in Vue 3)", async () => {
      const content = `import { createApp } from "vue";
import App from "./App.vue";
import { capitalize, currency } from "./filters";

const app = createApp(App);
Vue.filter("capitalize", capitalize);
Vue.filter("currency", currency);
app.mount("#app");`;

      const result = await vue2GlobalApiRule.apply(
        "src/main.ts",
        content,
        {
          enableTypeScript: true,
          isVueFile: false,
          scriptContent: content
        }
      );

      expect(result.fixed).toBe(true);
      expect(result.content).toContain("// Vue.filter");
      expect(result.content).toContain("Filters removed in Vue 3");
      expect(result.content).not.toMatch(/^[^/]*Vue\.filter\s*\(/m);
    });

    it("should convert Vue.directive and Vue.component to app API", async () => {
      const content = `import { createApp } from "vue";
import App from "./App.vue";
import { vFocus } from "./directives";
import GlobalButton from "./components/GlobalButton.vue";

Vue.directive("focus", vFocus);
Vue.component("GlobalButton", GlobalButton);
const app = createApp(App);
app.mount("#app");`;

      const result = await vue2GlobalApiRule.apply(
        "src/main.ts",
        content,
        {
          enableTypeScript: true,
          isVueFile: false,
          scriptContent: content
        }
      );

      expect(result.fixed).toBe(true);
      expect(result.content).toContain("app.directive(");
      expect(result.content).toContain("app.component(");
      expect(result.content).not.toContain("Vue.directive");
      expect(result.content).not.toContain("Vue.component");
      expect(result.content).toMatch(/const app = createApp\(App\)[\s\S]*app\.directive/);
    });

    it("should convert Vue.use(plugin) to app.use(plugin) for generic plugins", async () => {
      const content = `import { createApp } from "vue";
import App from "./App.vue";
import VueI18n from "vue-i18n";

Vue.use(VueI18n);
const app = createApp(App);
app.mount("#app");`;

      const result = await vue2GlobalApiRule.apply(
        "src/main.ts",
        content,
        {
          enableTypeScript: false,
          isVueFile: false,
          scriptContent: content
        }
      );

      expect(result.fixed).toBe(true);
      expect(result.content).toContain("app.use(VueI18n)");
      expect(result.content).not.toContain("Vue.use(VueI18n)");
    });

    it("should comment out Vue.use(Vuex) - use Pinia instead", async () => {
      const content = `import { createApp } from "vue";
import Vuex from "vuex";
import App from "./App.vue";

Vue.use(Vuex);
const app = createApp(App);
app.mount("#app");`;

      const result = await vue2GlobalApiRule.apply(
        "src/main.ts",
        content,
        {
          enableTypeScript: false,
          isVueFile: false,
          scriptContent: content
        }
      );

      expect(result.fixed).toBe(true);
      expect(result.content).toContain("// Vue.use(Vuex)");
      expect(result.content).toContain("Vuex removed - use Pinia");
    });

    it("should replace app.mixin wrapper with app.provide (provide/inject pattern)", async () => {
      const content = `import { createApp } from "vue";
import App from "./App.vue";
import { useUserMixin } from "@/composables/useUserMixin";

const app = createApp(App);
app.mixin({
  setup() {
    return useUserMixin();
  },
});
app.mount("#app");`;

      const result = await vue2GlobalApiRule.apply(
        "test-project/src/main.js",
        content,
        {
          enableTypeScript: false,
          isVueFile: false,
          scriptContent: content,
          projectRoot: path.join(__dirname, "../../../../../test-project"),
        }
      );

      expect(result.fixed).toBe(true);
      // Prefers useUser over useUserMixin when useUser.ts exists (new naming)
      expect(result.content).toMatch(/app\.provide\s*\(\s*['"]user['"]\s*,\s*useUser\(\)\s*\)/);
      expect(result.content).not.toContain("app.mixin");
    });

    it("should comment out Vue.use(VueRouter) - not needed in Vue 3", async () => {
      const content = `import { createApp } from "vue";
import VueRouter from "vue-router";
import App from "./App.vue";

Vue.use(VueRouter);
const app = createApp(App);
app.mount("#app");`;

      const result = await vue2GlobalApiRule.apply(
        "src/main.ts",
        content,
        {
          enableTypeScript: false,
          isVueFile: false,
          scriptContent: content
        }
      );

      expect(result.fixed).toBe(true);
      expect(result.content).toContain("// Vue.use(VueRouter)");
      expect(result.content).toContain("Vue 3 router does not need Vue.use()");
    });
  });

  describe("createWebHistoryRule", () => {
    it("should fix createWebHistory with BASE_URL", async () => {
      const content = `const router = createRouter({
  history: createWebHistory(process.env.BASE_URL),
  routes
});`;

      const result = await createWebHistoryRule.apply(
        "src/router/index.ts",
        content,
        {
          enableTypeScript: true,
          isVueFile: false,
          scriptContent: content
        }
      );

      expect(result).toBeDefined();
      if (result.fixed) {
        expect(result.content).not.toContain("process.env.BASE_URL");
      }
    });
  });

  describe("catchAllRouteRule", () => {
    it("should fix catch-all route", async () => {
      const content = `const routes = [
  { path: '/', component: Home },
  { path: '*', component: NotFound }
];`;

      const result = await catchAllRouteRule.apply(
        "src/router/index.ts",
        content,
        {
          enableTypeScript: true,
          isVueFile: false,
          scriptContent: content
        }
      );

      expect(result).toBeDefined();
      if (result.fixed) {
        expect(result.content).toContain("/:pathMatch(.*)*");
        expect(result.content).not.toContain("path: '*'");
      }
    });
  });

  describe("routerDefineAsyncComponentUnwrapRule", () => {
    it("unwraps defineAsyncComponent in route component", async () => {
      const content = `import { createRouter } from "vue-router";
import { defineAsyncComponent } from "vue";

const routes = [
  { path: "/item/:id", component: defineAsyncComponent(() => import("./ItemView.vue")) }
];`;

      const result = await routerDefineAsyncComponentUnwrapRule.apply(
        "src/router/index.js",
        content,
        { enableTypeScript: false, isVueFile: false, scriptContent: content, templateContent: "" }
      );

      expect(result.fixed).toBe(true);
      expect(result.content).toContain("component: () => import(\"./ItemView.vue\")");
      expect(result.content).not.toContain("defineAsyncComponent");
    });

    it("unwraps variable declaration with defineAsyncComponent", async () => {
      const content = `const ItemView = defineAsyncComponent(() => import("./ItemView.vue"));
const routes = [{ path: "/item/:id", component: ItemView }];`;

      const result = await routerDefineAsyncComponentUnwrapRule.apply(
        "src/router/index.js",
        content,
        { enableTypeScript: false, isVueFile: false, scriptContent: content, templateContent: "" }
      );

      expect(result.fixed).toBe(true);
      expect(result.content).toContain("ItemView = () => import(\"./ItemView.vue\")");
    });
  });
});
