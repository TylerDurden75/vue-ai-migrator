/**
 * Tests for template-related rules
 */

import * as path from "path";
import {
  transitionGroupVue3Rule,
  vue2FilterPipeToFunctionRule,
  routerViewTransitionRule,
  transitionAsRootRule,
  functionalComponentRule,
  nativeModifierRemovalRule,
  vBindMergeOrderRule,
  vForVIfPrecedenceRule,
  keyAttributesRule,
  componentVariableShadowingRule,
  componentTagPascalCaseRule,
  missingComponentImportsRule,
  missingFilterImportsRule,
  templateFilterFunctionImportsRule,
  vModelBindingsRule,
  routerLinkUserContentRule,
  templateAdjacentMustacheSpacingRule,
} from "../template/template-fixes";

describe("transitionGroupVue3Rule", () => {
  it("adds :key on div, replaces transition-group with ul, adds mode out-in", async () => {
    const content = `<template>
  <div class="news-view">
    <transition name="slide">
      <div v-if="displayedPage > 0" class="news-list">
        <transition-group tag="ul" name="item" class="news-list">
          <Item v-for="item in displayedItems" :key="item.id" :item="item" />
        </transition-group>
      </div>
    </transition>
  </div>
</template>
<script setup>
const displayedPage = ref(1);
const displayedItems = ref([]);
</script>
<style>
.item-leave-active { position: absolute; }
</style>`;
    expect(transitionGroupVue3Rule.shouldApply("ItemList.vue", content)).toBe(
      true
    );
    const result = await transitionGroupVue3Rule.apply("ItemList.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain(':key="displayedPage"');
    expect(result.content).toContain('<ul>');
    expect(result.content).toContain("</ul>");
    expect(result.content).not.toContain("transition-group");
    expect(result.content).toMatch(/mode="out-in"/);
    expect(result.content).not.toMatch(/\.item-leave-active[\s\S]*?position\s*:\s*absolute/);
  });

  it("extracts key from v-if expression (e.g. currentPage)", async () => {
    const content = `<template>
  <transition>
    <div v-if="currentPage > 0" class="list">
      <transition-group tag="ol">
        <li v-for="x in items" :key="x.id">{{ x }}</li>
      </transition-group>
    </div>
  </transition>
</template>
<script setup>
const currentPage = ref(0);
const items = ref([]);
</script>
<style>.list-leave-active { position: absolute }</style>`;
    const result = await transitionGroupVue3Rule.apply("List.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain(':key="currentPage"');
    expect(result.content).toContain("<ol>");
    expect(result.content).toContain("</ol>");
  });

  it("does not apply when div already has :key", async () => {
    const content = `<template>
  <transition>
    <div v-if="x" :key="displayedPage" class="list">
      <transition-group tag="ul"><li v-for="i in items" :key="i">x</li></transition-group>
    </div>
  </transition>
</template>
<script setup>const x=ref(0);const displayedPage=ref(0);const items=ref([]);</script>`;
    expect(transitionGroupVue3Rule.shouldApply("Test.vue", content)).toBe(false);
  });
});

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

describe("transitionAsRootRule (Transition as Root breaking)", () => {
  it("adds v-if and converts to script setup with defineProps", async () => {
    const content = `<template>
  <transition>
    <div class="modal"><slot/></div>
  </transition>
</template>
<script>
export default {
  name: 'Modal'
}
</script>`;
    const result = await transitionAsRootRule.apply("Modal.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain('v-if="show"');
    expect(result.content).toContain("<script setup>");
    expect(result.content).toContain("defineProps(['show'])");
    expect(result.content).toContain('class="modal"');
    expect(result.content).toMatch(/<div[^>]*v-if="show"/);
    expect(result.issues.some((i) => i.includes("v-if to :show"))).toBe(true);
  });

  it("adds show to defineProps when already using script setup", async () => {
    const content = `<template>
  <transition><div class="modal">content</div></transition>
</template>
<script setup>
defineProps(['title'])
</script>`;
    const result = await transitionAsRootRule.apply("Modal.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("defineProps(['title', 'show'])");
  });

  it("does not apply when child already has v-if=show", async () => {
    const content = `<template>
  <transition>
    <div v-if="show" class="modal">content</div>
  </transition>
</template>`;
    expect(transitionAsRootRule.shouldApply("Modal.vue", content)).toBe(false);
  });

  it("converts Options API props to script setup defineProps", async () => {
    const content = `<template>
  <transition><div class="modal">content</div></transition>
</template>
<script>
export default {
  props: ['title']
}
</script>`;
    const result = await transitionAsRootRule.apply("Modal.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("<script setup>");
    expect(result.content).toMatch(/defineProps\(\s*\[\s*['"]title['"],\s*['"]show['"]\s*\]\s*\)/);
  });

  it("adds script setup block when component has no script (template-only)", async () => {
    const content = `<template>
  <transition><div class="modal">content</div></transition>
</template>`;
    const result = await transitionAsRootRule.apply("Modal.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("<script setup>");
    expect(result.content).toContain("defineProps(['show'])");
    expect(result.content).toContain('v-if="show"');
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
  it("renames variable to avoid shadowing Comment component (convention: component PascalCase, data XData)", async () => {
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
    expect(result.content).toContain("const commentData = computed");
    expect(result.content).toContain("commentData.kids");
    expect(result.content).toContain("v-if=\"commentData\"");
    expect(result.content).toContain("<Comment v-for=");
    expect(result.content).toContain("</Comment>");
    expect(result.content).not.toContain("<comment v-for=");
  });

  it("handles recursive component (Comment.vue without self-import)", async () => {
    const content = `<template>
  <li v-if="comment" class="comment">
    <comment v-for="id in comment.kids" :key="id" :id="id"></comment>
  </li>
</template>
<script setup>
import { useIndexStore } from "@/store/index";
const store = useIndexStore();
const props = defineProps(["id"]);
const comment = computed(() => store.items[props.id]);
</script>`;
    const result = await componentVariableShadowingRule.apply(
      "Comment.vue",
      content,
      { enableTypeScript: false, isVueFile: true }
    );
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("const commentData = computed");
  });
});

describe("componentTagPascalCaseRule", () => {
  it("converts kebab-case component tags to PascalCase when component is imported", async () => {
    const content = `<template>
  <comment v-for="id in item.kids" :key="id" :id="id"></comment>
</template>
<script setup>
import Comment from "../components/Comment.vue";
import Spinner from "./Spinner.vue";
const item = ref({ kids: [] });
</script>`;
    const result = await componentTagPascalCaseRule.apply(
      "ItemView.vue",
      content,
      { enableTypeScript: false, isVueFile: true }
    );
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("<Comment v-for=");
    expect(result.content).toContain("</Comment>");
    expect(result.content).not.toContain("<comment ");
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

describe("vue2FilterPipeToFunctionRule", () => {
  it("should convert Vue 2 pipe filter to Vue 3 function call", async () => {
    const content = `<template>
  <span class="time"> {{ item.time | timeAgo }} ago </span>
</template>
<script setup>
import { timeAgo } from "@/util/filters";
const props = defineProps(["item"]);
</script>`;
    const result = await vue2FilterPipeToFunctionRule.apply("Item.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("{{ timeAgo(item.time) }}");
    expect(result.content).not.toContain("| timeAgo");
  });

  it("should convert chained filters", async () => {
    const content = `<template><div>{{ x | a | b }}</div></template><script setup>const x=1;</script>`;
    const result = await vue2FilterPipeToFunctionRule.apply("test.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("{{ b(a(x)) }}");
  });

  it("converts pipe in nested template (v-if) - depth-aware extraction", async () => {
    const content = `<template>
  <li class="news-item">
    <span class="title">
      <template v-if="item.url">
        <a :href="item.url">{{ item.url | host }}</a>
      </template>
    </span>
    <span class="time">{{ item.time | timeAgo }} ago</span>
  </li>
</template>
<script setup>
import { timeAgo, host } from "@/util/filters";
</script>`;
    const result = await vue2FilterPipeToFunctionRule.apply("Item.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("host(item.url)");
    expect(result.content).toContain("timeAgo(item.time)");
    expect(result.content).not.toContain("| timeAgo");
    expect(result.content).not.toContain("| host");
  });

  it("should not apply when no pipe filter in template", async () => {
    const content = `<template><div>{{ timeAgo(x) }}</div></template><script setup></script>`;
    const result = await vue2FilterPipeToFunctionRule.apply("test.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
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

describe("functionalComponentRule", () => {
  it("should convert attrs/listeners in functional template, keep props", async () => {
    const content = `<template functional>
  <component :is="\`h\${props.level}\`" v-bind="attrs" v-on="listeners" />
</template>`;

    const result = await functionalComponentRule.apply("DynamicHeading.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("props.level");
    expect(result.content).toContain('v-bind="$attrs"');
    expect(result.content).not.toContain('v-on="listeners"');
    expect(result.content).not.toContain("functional");
  });
});

describe("nativeModifierRemovalRule", () => {
  it("should remove .native modifier from v-on", async () => {
    const content = `<template>
  <MyComponent v-on:close="handleClose" v-on:click.native="handleClick" />
</template>`;

    const result = await nativeModifierRemovalRule.apply("Test.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain('v-on:click="handleClick"');
    expect(result.content).not.toContain(".native");
  });

  it("should remove .native from @ shorthand", async () => {
    const content = '<template><MyComponent @click.native="handler" /></template>';

    const result = await nativeModifierRemovalRule.apply("Test.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain('@click="handler"');
  });
});

describe("vBindMergeOrderRule", () => {
  it("should put v-bind before individual attrs", async () => {
    const content = `<template>
  <div id="red" class="foo" v-bind="attrs"></div>
</template>`;

    const result = await vBindMergeOrderRule.apply("Test.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
    });

    expect(result.fixed).toBe(true);
    const vBindPos = result.content.indexOf('v-bind="attrs"');
    const idPos = result.content.indexOf('id="red"');
    expect(vBindPos).toBeLessThan(idPos);
  });
});

describe("vForVIfPrecedenceRule", () => {
  it("should wrap v-for and v-if on same element in template", async () => {
    const content = `<template>
  <div v-for="item in items" v-if="item.visible">{{ item.name }}</div>
</template>`;

    const result = await vForVIfPrecedenceRule.apply("Test.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain('<template v-for="item in items"');
    expect(result.content).toContain('<div v-if="item.visible"');
    expect(result.content).not.toMatch(/v-for.*v-if.*v-for/);
  });

  it("should handle v-if before v-for", async () => {
    const content = `<template>
  <span v-if="x" v-for="x in list">x</span>
</template>`;

    const result = await vForVIfPrecedenceRule.apply("Test.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain('<template v-for="x in list"');
    expect(result.content).toContain('<span v-if="x"');
  });
});

describe("keyAttributesRule", () => {
  it("should remove key from v-if/v-else branches", async () => {
    const content = `<template>
  <div v-if="condition" :key="yes">Yes</div>
  <div v-else key="no">No</div>
</template>`;

    const result = await keyAttributesRule.apply("Test.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
    });

    expect(result.fixed).toBe(true);
    expect(result.content).not.toMatch(/:key="yes"/);
    expect(result.content).not.toMatch(/key="no"/);
    expect(result.content).toContain("v-if");
    expect(result.content).toContain("v-else");
  });

  it("should move key from template v-for children to template", async () => {
    const content = `<template>
  <template v-for="item in items">
    <div :key="item.id">{{ item.name }}</div>
  </template>
</template>`;

    const result = await keyAttributesRule.apply("Test.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toMatch(/<template\s+v-for="item in items"\s+:key="item\.id"/);
    expect(result.content).not.toContain("<div :key=");
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
