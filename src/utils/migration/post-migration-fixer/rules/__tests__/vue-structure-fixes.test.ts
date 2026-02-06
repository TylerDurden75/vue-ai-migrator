/**
 * Tests for Vue SFC structure rules (script/style inside template, duplicate symbols)
 */

import {
  scriptStyleInsideTemplateRule,
  duplicateSymbolDeclarationRule,
  scriptSetupUndeclaredVarsRule,
  loadingRefRule,
} from "../vue-structure-fixes";

describe("scriptStyleInsideTemplateRule", () => {
  it("should move script and style from inside template to correct position", async () => {
    const content = `<template>
  <div class="item">
    <h1>{{ item.title }}</h1>
    <script>
export default {
  props: ['item']
}
</script>
    <style scoped>
.item { color: red; }
</style>
  </div>
</template>`;

    const result = await scriptStyleInsideTemplateRule.apply("ItemView.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
      scriptContent: "",
      templateContent: ""
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("<template>");
    expect(result.content).toContain("<script>");
    expect(result.content).toContain("<style scoped>");
    const templateContent = result.content.match(/<template[^>]*>([\s\S]*?)<\/template>/)?.[1] ?? "";
    expect(templateContent).not.toContain("<script");
    expect(result.content).toMatch(/<\/template>\s*\n\s*\n\s*<script>/);
    expect(result.fixes).toContain("Moved script/style from inside template to correct SFC structure");
  });

  it("should not apply when script/style are at root level", async () => {
    const content = `<template>
  <div>{{ msg }}</div>
</template>

<script>
export default { data: () => ({ msg: 'hi' }) }
</script>

<style scoped>
div { color: blue; }
</style>`;

    const result = await scriptStyleInsideTemplateRule.apply("Ok.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
      scriptContent: "",
      templateContent: ""
    });

    expect(result.fixed).toBe(false);
  });

  it("should not apply to non-Vue files", async () => {
    const result = await scriptStyleInsideTemplateRule.shouldApply("foo.js", "x");
    expect(result).toBe(false);
  });

  it("should handle nested template v-if (root template extraction)", async () => {
    const content = `<template>
  <li class="news-item">
    <span class="title">
      <template v-if="item.url">
        <a :href="item.url">{{ item.title }}</a>
      </template>
      <script setup>
        const props = defineProps(["item"]);
      </script>
      <style scoped>.x { color: red; }</style>
      <span class="meta">meta</span>
    </span>
  </li>
</template>`;

    const result = await scriptStyleInsideTemplateRule.apply("Item.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
      scriptContent: "",
      templateContent: ""
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("<script setup>");
    expect(result.content).toContain("<style scoped>");
    expect(result.content).toContain("<template v-if=\"item.url\">");
    const templateContent = result.content.match(/<template[^>]*>([\s\S]*?)<\/template>/)?.[1] ?? "";
    expect(templateContent).not.toContain("<script");
    expect(templateContent).not.toContain("<style");
  });
});

describe("duplicateSymbolDeclarationRule", () => {
  it("should rename function when const with same name exists (fetchComments case)", async () => {
    const content = `<template><div>Item</div></template>
<script>
function fetchComments(store, item) {
  if (!item.kids) return;
  item.kids.forEach(id => fetchComments(store, store.state.items[id]));
}
export default {
  methods: {
    fetchComments() {
      fetchComments(this.$store, this.item);
    }
  }
}
</script>`;

    const result = await duplicateSymbolDeclarationRule.apply("ItemView.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
      scriptContent: "",
      templateContent: ""
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("function doFetchComments(store, item)");
    expect(result.content).not.toContain("fetchComments(store, store.state.items[id])");
    expect(result.content).toContain("doFetchComments(store, store.state.items[id])");
    expect(result.content).toContain("doFetchComments(this.$store, this.item)");
    expect(result.content).toContain("fetchComments()"); // method name stays
    expect(result.fixes).toContain("Renamed duplicate symbol fetchComments to doFetchComments");
  });

  it("should not apply when no duplicate symbol", async () => {
    const content = `<template><div></div></template>
<script>
function helper(x) { return x + 1; }
export default { methods: { foo() { return helper(1); } } };
</script>`;

    const result = await duplicateSymbolDeclarationRule.apply("Ok.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
      scriptContent: "",
      templateContent: ""
    });

    expect(result.fixed).toBe(false);
  });

  it("should not apply to files without script", async () => {
    const result = await duplicateSymbolDeclarationRule.shouldApply("foo.vue", "<template><div/></template>");
    expect(result).toBe(false);
  });
});

describe("scriptSetupUndeclaredVarsRule", () => {
  it("should add let declaration for _timer and _cut when assigned but not declared", async () => {
    const content = `<template><div></div></template>
<script setup>
import { ref } from "vue";
const percent = ref(0);
const start = () => {
  if (_timer) clearInterval(_timer);
  _cut = 10000 / 100;
  _timer = setInterval(() => {}, 100);
};
</script>`;

    const result = await scriptSetupUndeclaredVarsRule.apply("ProgressBar.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
      scriptContent: "",
      templateContent: "",
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("let _cut = 0");
    expect(result.content).toContain("let _timer = null");
    expect(result.content).not.toContain("let value = null");
  });

  it("should not add value (excluded - property access)", async () => {
    const content = `<template><div></div></template>
<script setup>
import { ref } from "vue";
const percent = ref(0);
const start = () => {
  percent.value = 0;
};
</script>`;

    const result = await scriptSetupUndeclaredVarsRule.apply("ProgressBar.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
      scriptContent: "",
      templateContent: "",
    });

    expect(result.fixed).toBe(false);
  });
});

describe("loadingRefRule", () => {
  it("adds const loading = ref(false) when loading is assigned and used in template", async () => {
    const content = `<template>
  <spinner :show="loading"></spinner>
  <ul v-if="!loading">...</ul>
</template>
<script setup>
import { computed } from "vue";
const fetchComments = () => {
  loading = true;
  doFetch().then(() => { loading = false; });
};
</script>`;

    const result = await loadingRefRule.apply("ItemView.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
      scriptContent: "",
      templateContent: "",
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("const loading = ref(false)");
    expect(result.content).toContain("loading.value = true");
    expect(result.content).toContain("loading.value = false");
    expect(result.content).toContain(":show=\"loading\"");
  });

  it("adds ref for isLoading (generic: any var assigned + in template)", async () => {
    const content = `<template>
  <div v-if="isLoading">Loading...</div>
</template>
<script setup>
const fetch = () => { isLoading = true; api().then(() => { isLoading = false; }); };
</script>`;

    const result = await loadingRefRule.apply("DetailView.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
      scriptContent: "",
      templateContent: "",
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("const isLoading = ref(false)");
    expect(result.content).toContain("isLoading.value = true");
    expect(result.content).toContain("isLoading.value = false");
  });
});
