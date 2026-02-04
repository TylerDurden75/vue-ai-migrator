/**
 * Tests for computed-related rules
 */

import {
  computedValueRule,
  vueComputedExtraParenRule,
  malformedComputedRule,
  computedSyntaxRule
} from "../computed-fixes";

describe("computedValueRule", () => {
  it("should add .value to computed properties when accessing length", async () => {
    const content = `<script setup lang="ts">
import { computed } from 'vue';
const items = computed(() => [1, 2, 3]);
const count = items.length;
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await computedValueRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("items.value.length");
    expect(result.content).not.toContain("items.length");
    expect(result.fixes.some(fix => fix.includes(".value"))).toBe(true);
  });

  it("should add .value to computed properties when accessing array methods", async () => {
    const content = `<script setup lang="ts">
import { computed } from 'vue';
const items = computed(() => [1, 2, 3]);
const filtered = items.filter(x => x > 1);
const mapped = items.map(x => x * 2);
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await computedValueRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("items.value.filter");
    expect(result.content).toContain("items.value.map");
  });

  it("should handle multiple computed properties", async () => {
    const content = `<script setup lang="ts">
import { computed } from 'vue';
const users = computed(() => []);
const products = computed(() => []);
const userCount = users.length;
const productCount = products.length;
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await computedValueRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("users.value.length");
    expect(result.content).toContain("products.value.length");
  });

  it("should not modify when .value is already present", async () => {
    const content = `<script setup lang="ts">
import { computed } from 'vue';
const items = computed(() => [1, 2, 3]);
const count = items.value.length;
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await computedValueRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent
    });

    // Should not add duplicate .value
    const valueMatches = result.content.match(/items\.value\.value/g);
    expect(valueMatches).toBeNull();
  });

  it("should not apply when no computed properties are present", async () => {
    const content = `<script setup lang="ts">
const items = ref([1, 2, 3]);
const count = items.length;
</script>`;

    const result = await computedValueRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });

    expect(result.fixed).toBe(false);
  });

  it("should not apply when script content is missing", async () => {
    const content = `<template>
  <div>Test</div>
</template>`;

    const result = await computedValueRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });

    expect(result.fixed).toBe(false);
  });

  it("should not apply to non-Vue files", async () => {
    const content = `const items = computed(() => [1, 2, 3]);
const count = items.length;`;

    const result = await computedValueRule.apply("test.ts", content, {
      enableTypeScript: false,
      isVueFile: false
    });

    expect(result.fixed).toBe(false);
  });

  it("should handle computed with find method", async () => {
    const content = `<script setup lang="ts">
import { computed } from 'vue';
const users = computed(() => [{ id: 1, name: 'John' }]);
const user = users.find(u => u.id === 1);
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await computedValueRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("users.value.find");
  });
});

describe("vueComputedExtraParenRule", () => {
  it("should fix })); to }); in .vue computed", async () => {
    const content = `<script setup lang="ts">
const user = computed<any>(() => {
  return store.getUser();
}));
</script>`;
    const result = await vueComputedExtraParenRule.apply("UserDetail.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("});");
    expect(result.content).not.toContain("}));");
  });

  it("should not apply when no })); is present", async () => {
    const content = `<script setup>const x = computed(() => 1);</script>`;
    const result = await vueComputedExtraParenRule.apply("test.vue", content, {
      enableTypeScript: false,
      isVueFile: true
    });
    expect(result.fixed).toBe(false);
  });
});

describe("malformedComputedRule", () => {
  it("should fix computed<any>() => pattern", async () => {
    const content = `const myComputed = computed<any>() => 'test';`;

    const result = await malformedComputedRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("computed<any>(() =>");
    expect(result.content).not.toContain("computed<any>() =>");
    expect(result.fixes.some(fix => fix.includes("malformed"))).toBe(true);
  });

  it("should fix computed() => pattern", async () => {
    const content = `const myComputed = computed() => 'test';`;

    const result = await malformedComputedRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("computed(() =>");
    expect(result.content).not.toContain("computed() =>");
  });

  it("should fix computed<any>() => (expression) pattern", async () => {
    const content = `const myComputed = computed<any>() => (items.length);`;

    const result = await malformedComputedRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("computed<any>(() =>");
  });

  it("should handle multiple malformed computed patterns", async () => {
    const content = `const computed1 = computed<any>() => 'test1';
const computed2 = computed() => 'test2';`;

    const result = await malformedComputedRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("computed<any>(() =>");
    expect(result.content).toContain("computed(() =>");
  });

  it("should not modify when computed syntax is correct", async () => {
    const content = `const myComputed = computed(() => 'test');`;

    const result = await malformedComputedRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });

    expect(result.fixed).toBe(false);
  });

  it("should not apply when no malformed computed patterns are present", async () => {
    const content = `const test = ref(1);`;

    const result = await malformedComputedRule.apply("test.vue", content, {
      enableTypeScript: false,
      isVueFile: true
    });

    expect(result.fixed).toBe(false);
  });
});

describe("computedSyntaxRule", () => {
  it("should fix computed accessing another computed without .value", async () => {
    const content = `<script setup lang="ts">
import { computed } from 'vue';
const items = computed(() => [1, 2, 3]);
const count = computed(() => items.length);
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await computedSyntaxRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("items.value.length");
  });

  it("should fix computed(() => store.property || [].length) pattern", async () => {
    const content = `<script setup lang="ts">
import { computed } from 'vue';
const userStore = useUserStore();
const count = computed(() => userStore.allUsers || [].length);
</script>`;

    const result = await computedSyntaxRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent: content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || ""
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toMatch(/\(userStore\.allUsers\s+\|\|\s+\[\]\)\.length/);
    expect(result.content).not.toContain("|| [].length");
  });

  it("should fix computed<any>(() => (expr); malformed paren (Expected ')' but found ';')", async () => {
    const content = `const allProducts = computed<any>(() => (productStore.allProducts);`;
    const result = await computedSyntaxRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("computed<any>(() => productStore.allProducts);");
    expect(result.content).not.toContain("(() => (productStore.allProducts);");
  });

  it("should handle multiple computed syntax issues", async () => {
    const content = `<script setup lang="ts">
import { computed } from 'vue';
const items = computed(() => [1, 2, 3]);
const products = computed(() => [4, 5, 6]);
const itemCount = computed(() => items.length);
const productCount = computed(() => products.length);
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await computedSyntaxRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("items.value.length");
    expect(result.content).toContain("products.value.length");
  });

  it("should not modify when computed syntax is correct", async () => {
    const content = `<script setup lang="ts">
import { computed } from 'vue';
const items = computed(() => [1, 2, 3]);
const count = computed(() => items.value.length);
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await computedSyntaxRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent
    });

    // Should not modify when already correct
    expect(result.content).toContain("items.value.length");
  });

  it("should not apply when no computed is present", async () => {
    const content = `<script setup lang="ts">
const items = ref([1, 2, 3]);
const count = items.length;
</script>`;

    const result = await computedSyntaxRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });

    expect(result.fixed).toBe(false);
  });

  it("should handle computed with map method", async () => {
    const content = `<script setup lang="ts">
import { computed } from 'vue';
const items = computed(() => [1, 2, 3]);
const doubled = computed(() => items.map(x => x * 2));
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await computedSyntaxRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("items.value.map");
  });

  it("should handle computed with filter method", async () => {
    const content = `<script setup lang="ts">
import { computed } from 'vue';
const items = computed(() => [1, 2, 3]);
const filtered = computed(() => items.filter(x => x > 1));
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await computedSyntaxRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("items.value.filter");
  });
});
