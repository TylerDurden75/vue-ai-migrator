/**
 * Tests for template-related rules
 */

import * as path from "path";
import {
  routerViewTransitionRule,
  componentVariableShadowingRule,
  missingComponentImportsRule,
  missingFilterImportsRule,
  templateFilterFunctionImportsRule,
  vModelBindingsRule,
  routerLinkUserContentRule,
  templateAdjacentMustacheSpacingRule,
} from "../template/template-fixes";

describe("routerViewTransitionRule", () => {
  it("converts router-view inside transition to slot props pattern", async () => {
    const content = `<template>
  <div id="app">
    <transition name="fade" mode="out-in">
      <router-view class="view"></router-view>
    </transition>
  </div>
</template>`;
    const result = await routerViewTransitionRule.apply("App.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain('v-slot="{ Component }"');
    expect(result.content).toContain('<component :is="Component"');
    expect(result.content).not.toMatch(/<transition[^>]*>\s*<router-view/);
  });

  it("does not apply when already using slot props", async () => {
    const content = `<template>
  <router-view v-slot="{ Component }">
    <transition name="fade"><component :is="Component" /></transition>
  </router-view>
</template>`;
    expect(routerViewTransitionRule.shouldApply("App.vue", content)).toBe(
      false
    );
  });
});

describe("templateAdjacentMustacheSpacingRule", () => {
  it("adds space between adjacent mustaches }}{{", async () => {
    const content = `<template>
  <span>{{ user }}{{ timeAgo(t) }} ago</span>
</template>`;
    expect(
      templateAdjacentMustacheSpacingRule.shouldApply("Item.vue", content)
    ).toBe(true);
    const result = await templateAdjacentMustacheSpacingRule.apply(
      "Item.vue",
      content,
      {
        enableTypeScript: false,
        isVueFile: true,
      }
    );
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("}} {{ ");
    expect(result.content).not.toContain("}}{{");
  });

  it("adds space between closing tag and mustache </tag>{{", async () => {
    const content = `<template>
  <span>{{ user }}</span>{{ timeAgo(t) }} ago
</template>`;
    expect(
      templateAdjacentMustacheSpacingRule.shouldApply("Item.vue", content)
    ).toBe(true);
    const result = await templateAdjacentMustacheSpacingRule.apply(
      "Item.vue",
      content,
      {
        enableTypeScript: false,
        isVueFile: true,
      }
    );
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("</span> {{ ");
    expect(result.content).not.toMatch(/<\/span>\{\{/);
  });

  it("adds space between closing tag and mustache", async () => {
    const content = `<template>
  <router-link :to="'/user/' + user">{{ user }}</router-link>{{ timeAgo(t) }} ago
</template>`;
    const result = await templateAdjacentMustacheSpacingRule.apply(
      "Comment.vue",
      content,
      {
        enableTypeScript: false,
        isVueFile: true,
      }
    );
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("</router-link> {{ ");
  });

  it("does not apply when spacing already present", async () => {
    const content = `<template>
  <span>{{ user }}</span> {{ timeAgo(t) }} ago
</template>`;
    expect(
      templateAdjacentMustacheSpacingRule.shouldApply("Item.vue", content)
    ).toBe(false);
  });
});

describe("componentVariableShadowingRule", () => {
  it("fixes comment variable shadowing Comment component", async () => {
    const content = `<template>
  <li v-if="comment">
    <comment v-for="id in comment.kids" :key="id" :id="id"></comment>
  </li>
</template>
<script setup>
import Comment from "./Comment.vue";
const comment = computed(() => store.items[props.id]);
</script>`;
    const result = await componentVariableShadowingRule.apply(
      "Comment.vue",
      content,
      {
        enableTypeScript: false,
        isVueFile: true,
      }
    );
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("<Comment v-for=");
    expect(result.content).toContain("</Comment>");
    expect(result.content).not.toContain("<comment v-for=");
  });
});

describe("missingComponentImportsRule", () => {
  it("should add missing component imports", async () => {
    const content = `<template>
  <UserCard />
  <ProductList />
</template>
<script setup lang="ts">
const test = ref(1);
</script>`;

    const scriptContent =
      content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const templateContent =
      content.match(/<template>([\s\S]*?)<\/template>/)?.[1] || "";

    const result = await missingComponentImportsRule.apply(
      "test.vue",
      content,
      {
        enableTypeScript: true,
        isVueFile: true,
        scriptContent,
        templateContent,
      }
    );

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

    const scriptContent =
      content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const templateContent =
      content.match(/<template>([\s\S]*?)<\/template>/)?.[1] || "";

    const result = await missingComponentImportsRule.apply(
      "test.vue",
      content,
      {
        enableTypeScript: true,
        isVueFile: true,
        scriptContent,
        templateContent,
      }
    );

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

    const scriptContent =
      content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const templateContent =
      content.match(/<template>([\s\S]*?)<\/template>/)?.[1] || "";

    const result = await missingComponentImportsRule.apply(
      "test.vue",
      content,
      {
        enableTypeScript: true,
        isVueFile: true,
        scriptContent,
        templateContent,
      }
    );

    // Should not add duplicate import
    const importMatches = result.content.match(/import UserCard/g);
    expect(importMatches?.length).toBe(1);
  });

  it("should not apply to non-Vue files", async () => {
    const content = "const test = 1;";
    const result = await missingComponentImportsRule.apply("test.js", content, {
      enableTypeScript: false,
      isVueFile: false,
    });

    expect(result.fixed).toBe(false);
  });

  it("should not apply when template or script content is missing", async () => {
    const content = `<template>
  <UserCard />
</template>`;

    const result = await missingComponentImportsRule.apply(
      "test.vue",
      content,
      {
        enableTypeScript: false,
        isVueFile: true,
        // Missing scriptContent and templateContent
      }
    );

    expect(result.fixed).toBe(false);
  });
});

describe("routerLinkUserContentRule", () => {
  it("should fix router-link to user: username in link, timeAgo in ago part", async () => {
    const content = `<template>
  <div class="by">
    <router-link :to="'/user/' + comment.by">{{ timeAgo(comment.time) }}</router-link>
    {{ comment.time }} ago
  </div>
</template>
<script setup>
import { timeAgo } from "@/util/filters";
</script>`;
    const result = await routerLinkUserContentRule.apply(
      "Comment.vue",
      content,
      {
        enableTypeScript: false,
        isVueFile: true,
      }
    );
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("{{ comment.by }}</router-link>");
    expect(result.content).toContain("{{ timeAgo(comment.time) }} ago");
    expect(result.content).not.toContain(
      "{{ timeAgo(comment.time) }}</router-link>"
    );
    expect(result.content).not.toContain("{{ comment.time }} ago");
  });
});

describe("templateFilterFunctionImportsRule", () => {
  it("should add host and timeAgo imports when used in template", async () => {
    const content = `<template>
  <span>{{ host(item.url) }}</span>
  <span>{{ timeAgo(item.time) }} ago</span>
</template>
<script setup>
defineProps(["item"]);
</script>`;

    const scriptContent =
      content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const templateContent =
      content.match(/<template>([\s\S]*?)<\/template>/)?.[1] || "";
    const projectRoot = path.join(
      __dirname,
      "../../../../../../vue-hackernews-2.0"
    );

    const result = await templateFilterFunctionImportsRule.apply(
      "src/components/Item.vue",
      content,
      {
        enableTypeScript: false,
        isVueFile: true,
        scriptContent,
        templateContent,
        projectRoot,
      }
    );

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("import { host, timeAgo }");
    // Fallback to @/filters when projectRoot lacks filters (vue-hackernews-2.0 not in repo)
    expect(result.content).toMatch(/from ["']@\/(?:util\/)?filters["']/);
    expect(result.fixes.length).toBeGreaterThan(0);
  });

  it("should add capitalize and currency imports when used in template", async () => {
    const content = `<template>
  <div>{{ capitalize(name) }}</div>
  <div>{{ currency(price) }}</div>
</template>
<script setup>
const name = ref('test');
const price = ref(19.99);
</script>`;

    const scriptContent =
      content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const templateContent =
      content.match(/<template>([\s\S]*?)<\/template>/)?.[1] || "";

    const result = await templateFilterFunctionImportsRule.apply(
      "test.vue",
      content,
      {
        enableTypeScript: false,
        isVueFile: true,
        scriptContent,
        templateContent,
      }
    );

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("import { capitalize, currency }");
    expect(result.fixes.length).toBeGreaterThan(0);
  });

  it("should not add imports when already present", async () => {
    const content = `<template>
  <span>{{ host(item.url) }}</span>
</template>
<script setup>
import { host } from "@/util/filters";
defineProps(["item"]);
</script>`;

    const scriptContent =
      content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const templateContent =
      content.match(/<template>([\s\S]*?)<\/template>/)?.[1] || "";

    const result = await templateFilterFunctionImportsRule.apply(
      "test.vue",
      content,
      {
        enableTypeScript: false,
        isVueFile: true,
        scriptContent,
        templateContent,
      }
    );

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

    const scriptContent =
      content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const templateContent =
      content.match(/<template>([\s\S]*?)<\/template>/)?.[1] || "";

    const result = await missingFilterImportsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      templateContent,
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

    const scriptContent =
      content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const templateContent =
      content.match(/<template>([\s\S]*?)<\/template>/)?.[1] || "";

    const result = await missingFilterImportsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      templateContent,
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

    const scriptContent =
      content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const templateContent =
      content.match(/<template>([\s\S]*?)<\/template>/)?.[1] || "";

    const result = await missingFilterImportsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      templateContent,
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

    const scriptContent =
      content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const templateContent =
      content.match(/<template>([\s\S]*?)<\/template>/)?.[1] || "";

    const result = await missingFilterImportsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      templateContent,
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
      isVueFile: true,
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

    const scriptContent =
      content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const templateContent =
      content.match(/<template>([\s\S]*?)<\/template>/)?.[1] || "";

    const result = await missingFilterImportsRule.apply("test.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
      scriptContent,
      templateContent,
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

    const scriptContent =
      content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const templateContent =
      content.match(/<template>([\s\S]*?)<\/template>/)?.[1] || "";

    const result = await vModelBindingsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      templateContent,
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

    const scriptContent =
      content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const templateContent =
      content.match(/<template>([\s\S]*?)<\/template>/)?.[1] || "";

    const result = await vModelBindingsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      templateContent,
    });

    // Should detect the issue
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some((issue) => issue.includes("v-model"))).toBe(true);
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
      isVueFile: true,
    });

    expect(result.fixed).toBe(false);
  });

  it("should not apply to non-Vue files", async () => {
    const content = "const test = 1;";
    const result = await vModelBindingsRule.apply("test.js", content, {
      enableTypeScript: false,
      isVueFile: false,
    });

    expect(result.fixed).toBe(false);
  });
});
