/**
 * Unit tests for router fixes rules
 */

import { createAppSyntaxRule, vue2GlobalApiRule, createWebHistoryRule, catchAllRouteRule, routerDefineAsyncComponentUnwrapRule } from "../rules/router-fixes";

describe("Router Fixes Rules", () => {
  describe("createAppSyntaxRule", () => {
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
