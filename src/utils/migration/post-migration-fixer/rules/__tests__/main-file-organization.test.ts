/**
 * Unit tests for main file organization rule
 */

import { mainFileOrganizationRule } from "../main/main-file-organization";

describe("mainFileOrganizationRule", () => {
  const baseContext = { enableTypeScript: false, isVueFile: false, scriptContent: "" };

  it("should remove unused imports and organize imports at top", async () => {
    const content = `import { createApp, h } from 'vue';
import { createPinia } from "pinia";
import App from './App.vue';
import router from './router';

// Register global mixin
import { useUser } from '@/composables/useUser';

// Register global filters
import { capitalize, currency } from './filters';
// // // Vue.filter('capitalize', capitalize); // Filters removed in Vue 3
// // // Vue.filter('currency', currency); // Filters removed in Vue 3

// Register global directives
import { vFocus, vTooltip } from './directives';



// Register global component
import GlobalButton from './components/GlobalButton.vue';


const app = createApp(App);


app.component('GlobalButton', GlobalButton);
app.directive('tooltip', vTooltip);
app.directive('focus', vFocus);
app.mixin({ setup() { return useUser(); } });

app.use(createPinia());
app.use(router);
app.mount('#app');
`;

    const result = await mainFileOrganizationRule.apply(
      "src/main.js",
      content,
      { ...baseContext, scriptContent: content }
    );

    expect(result.fixed).toBe(true);
    expect(result.content).not.toContain("from './filters'");
    expect(result.content).not.toContain("// Register global filters");
    expect(result.content).toContain("import { createApp } from 'vue'");
    expect(result.content).not.toContain(", h } from 'vue'");
    expect(result.content).toContain("import { createPinia }");
    expect(result.content).toContain("app.mount('#app')");
    // All imports should be at top
    const firstImportIdx = result.content.indexOf("import ");
    const createAppIdx = result.content.indexOf("const app = createApp");
    expect(firstImportIdx).toBeLessThan(createAppIdx);
  });

  it("should reorder app.use(Pinia) before app.provide when provide uses stores", async () => {
    const content = `import { createApp } from 'vue';
import { createPinia } from "pinia";
import App from './App.vue';
import router from './router';
import { useUser } from '@/composables/useUser';
import GlobalButton from './components/GlobalButton.vue';

const app = createApp(App);
app.component("GlobalButton", GlobalButton);
app.provide("user", useUser());
app.use(createPinia());
app.use(router);
app.mount('#app');
`;

    const result = await mainFileOrganizationRule.apply(
      "src/main.js",
      content,
      { ...baseContext, scriptContent: content }
    );

    expect(result.fixed).toBe(true);
    const piniaIdx = result.content.indexOf("app.use(createPinia()");
    const provideIdx = result.content.indexOf("app.provide(");
    expect(piniaIdx).toBeLessThan(provideIdx);
  });

  it("should not remove imports that are used", async () => {
    const content = `import { createApp } from 'vue';
import App from './App.vue';

const app = createApp(App);
app.mount('#app');
`;

    const result = await mainFileOrganizationRule.apply("src/main.js", content, {
      ...baseContext,
      scriptContent: content
    });

    expect(result.content).toContain("import { createApp } from 'vue'");
    expect(result.content).toContain("import App from './App.vue'");
  });
});
