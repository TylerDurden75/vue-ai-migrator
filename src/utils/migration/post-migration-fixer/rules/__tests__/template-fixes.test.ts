/**
 * Tests for template-related rules
 */

import {
  missingComponentImportsRule,
  missingFilterImportsRule,
  vModelBindingsRule
} from "../template-fixes";

describe("missingComponentImportsRule", () => {
  it("should add missing component imports", async () => {
    const content = `<template>
  <UserCard />
  <ProductList />
</template>
<script setup lang="ts">
const test = ref(1);
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const templateContent = content.match(/<template>([\s\S]*?)<\/template>/)?.[1] || "";

    const result = await missingComponentImportsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      templateContent
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("import UserCard");
    expect(result.content).toContain("import ProductList");
    expect(result.fixes.length).toBeGreaterThan(0);
  });

  it("should not add imports for built-in Vue components", async () => {
    const content = `<template>
  <RouterView />
  <RouterLink to="/">Home</RouterLink>
</template>
<script setup lang="ts">
const test = ref(1);
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const templateContent = content.match(/<template>([\s\S]*?)<\/template>/)?.[1] || "";

    const result = await missingComponentImportsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      templateContent
    });

    expect(result.content).not.toContain("import RouterView");
    expect(result.content).not.toContain("import RouterLink");
  });

  it("should not modify content when components are already imported", async () => {
    const content = `<template>
  <UserCard />
</template>
<script setup lang="ts">
import UserCard from '@/components/UserCard.vue';
const test = ref(1);
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const templateContent = content.match(/<template>([\s\S]*?)<\/template>/)?.[1] || "";

    const result = await missingComponentImportsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      templateContent
    });

    // Should not add duplicate import
    const importMatches = result.content.match(/import UserCard/g);
    expect(importMatches?.length).toBe(1);
  });

  it("should not apply to non-Vue files", async () => {
    const content = "const test = 1;";
    const result = await missingComponentImportsRule.apply("test.js", content, {
      enableTypeScript: false,
      isVueFile: false
    });

    expect(result.fixed).toBe(false);
  });

  it("should not apply when template or script content is missing", async () => {
    const content = `<template>
  <UserCard />
</template>`;

    const result = await missingComponentImportsRule.apply("test.vue", content, {
      enableTypeScript: false,
      isVueFile: true
      // Missing scriptContent and templateContent
    });

    expect(result.fixed).toBe(false);
  });
});

describe("missingFilterImportsRule", () => {
  it("should add missing filter functions", async () => {
    const content = `<template>
  <div>{{ name | capitalize }}</div>
  <div>{{ price | currency }}</div>
</template>
<script setup lang="ts">
const name = ref('test');
const price = ref(19.99);
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const templateContent = content.match(/<template>([\s\S]*?)<\/template>/)?.[1] || "";

    const result = await missingFilterImportsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      templateContent
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("const capitalize");
    expect(result.content).toContain("const currency");
    expect(result.fixes.length).toBeGreaterThan(0);
  });

  it("should not add filters that are already defined", async () => {
    const content = `<template>
  <div>{{ name | capitalize }}</div>
</template>
<script setup lang="ts">
const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);
const name = ref('test');
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const templateContent = content.match(/<template>([\s\S]*?)<\/template>/)?.[1] || "";

    const result = await missingFilterImportsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      templateContent
    });

    // Should not add duplicate filter
    const capitalizeMatches = result.content.match(/const capitalize/g);
    expect(capitalizeMatches?.length).toBe(1);
  });

  it("should add generic filter function for unknown filter names", async () => {
    const content = `<template>
  <div>{{ date | formatDate }}</div>
</template>
<script setup lang="ts">
const date = ref(new Date());
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const templateContent = content.match(/<template>([\s\S]*?)<\/template>/)?.[1] || "";

    const result = await missingFilterImportsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      templateContent
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("const formatDate");
    expect(result.content).toContain("(val: any) => val");
    expect(result.content).toContain("TODO: Implement formatDate");
  });

  it("should not apply when no filters are used", async () => {
    const content = `<template>
  <div>{{ name }}</div>
</template>
<script setup lang="ts">
const name = ref('test');
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const templateContent = content.match(/<template>([\s\S]*?)<\/template>/)?.[1] || "";

    const result = await missingFilterImportsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      templateContent
    });

    expect(result.fixed).toBe(false);
  });

  it("should not apply to files without pipe operator", async () => {
    const content = `<template>
  <div>{{ name }}</div>
</template>
<script setup lang="ts">
const name = ref('test');
</script>`;

    const result = await missingFilterImportsRule.apply("test.vue", content, {
      enableTypeScript: false,
      isVueFile: true
    });

    expect(result.fixed).toBe(false);
  });

  it("should not add invalid filter from || 0 (logical OR, not Vue filter)", async () => {
    const content = `<template>
  <div>{{ String(item.amount).split(".")[1] || 0 }}</div>
</template>
<script setup>
const item = ref({ amount: 12.5 });
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const templateContent = content.match(/<template>([\s\S]*?)<\/template>/)?.[1] || "";

    const result = await missingFilterImportsRule.apply("test.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
      scriptContent,
      templateContent
    });

    expect(result.fixed).toBe(false);
    expect(result.content).not.toContain("const 0 =");
  });
});

describe("vModelBindingsRule", () => {
  it("should detect v-model bindings", async () => {
    const content = `<template>
  <input v-model="username" />
</template>
<script setup lang="ts">
const username = ref('');
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const templateContent = content.match(/<template>([\s\S]*?)<\/template>/)?.[1] || "";

    const result = await vModelBindingsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      templateContent
    });

    // Rule detects bindings but may not fix if already correct
    expect(result).toBeDefined();
  });

  it("should detect issues when computed is used with v-model", async () => {
    const content = `<template>
  <input v-model="username" />
</template>
<script setup lang="ts">
const username = computed(() => 'test');
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const templateContent = content.match(/<template>([\s\S]*?)<\/template>/)?.[1] || "";

    const result = await vModelBindingsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      templateContent
    });

    // Should detect the issue
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some(issue => issue.includes("v-model"))).toBe(true);
  });

  it("should not apply when v-model is not present", async () => {
    const content = `<template>
  <div>{{ username }}</div>
</template>
<script setup lang="ts">
const username = ref('');
</script>`;

    const result = await vModelBindingsRule.apply("test.vue", content, {
      enableTypeScript: false,
      isVueFile: true
    });

    expect(result.fixed).toBe(false);
  });

  it("should not apply to non-Vue files", async () => {
    const content = "const test = 1;";
    const result = await vModelBindingsRule.apply("test.js", content, {
      enableTypeScript: false,
      isVueFile: false
    });

    expect(result.fixed).toBe(false);
  });
});
