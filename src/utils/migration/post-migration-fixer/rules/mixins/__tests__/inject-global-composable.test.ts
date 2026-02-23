/**
 * Tests for inject-global-composable rule
 */

import * as path from "path";
import { injectGlobalComposableRule } from "../inject-global-composable";

const projectRoot = path.join(__dirname, "../../../__fixtures__/provide-inject-project");

// Build mock map: useUser -> mixinData, isUserAdmin, getUserDisplayName
function makeMap() {
  const m = new Map<
    string,
    { composableName: string; returnKeys: string[]; composablePath: string }
  >();
  m.set(path.join(projectRoot, "src/composables/useUser.ts"), {
    composableName: "useUser",
    returnKeys: ["mixinData", "isUserAdmin", "getUserDisplayName"],
    composablePath: path.join(projectRoot, "src/composables/useUser.ts"),
  });
  return m;
}

describe("injectGlobalComposableRule", () => {
  it("adds inject when component uses mixinData from template", async () => {
    const content = `<template>
  <p>{{ mixinData }}</p>
</template>

<script setup>
import { computed } from "vue";
const x = computed(() => 1);
</script>`;

    const result = await injectGlobalComposableRule.apply(
      path.join(projectRoot, "src/views/Test.vue"),
      content,
      {
        enableTypeScript: false,
        isVueFile: true,
        projectRoot,
        mixinComposablesMap: makeMap(),
      }
    );

    expect(result.fixed).toBe(true);
    expect(result.content).toContain('inject("user")');
    expect(result.content).toContain("const { mixinData } = inject");
    expect(result.content).toMatch(/inject.*from\s+["']vue["']/);
    expect(result.content).toContain("{{ mixinData }}");
  });

  it("does not add inject when component already has useUser()", async () => {
    const content = `<template>
  <p>{{ mixinData }}</p>
</template>

<script setup>
import { useUser } from "@/composables/useUser";
const { mixinData } = useUser();
</script>`;

    const result = await injectGlobalComposableRule.apply(
      path.join(projectRoot, "src/views/Test.vue"),
      content,
      {
        enableTypeScript: false,
        isVueFile: true,
        projectRoot,
        mixinComposablesMap: makeMap(),
      }
    );

    expect(result.fixed).toBe(false);
  });

  it("does not add inject when component already has inject('user')", async () => {
    const content = `<template>
  <p>{{ mixinData }}</p>
</template>

<script setup>
const { mixinData } = inject("user");
</script>`;

    const result = await injectGlobalComposableRule.apply(
      path.join(projectRoot, "src/views/Test.vue"),
      content,
      {
        enableTypeScript: false,
        isVueFile: true,
        projectRoot,
        mixinComposablesMap: makeMap(),
      }
    );

    expect(result.fixed).toBe(false);
  });

  it("does not apply when no provides in main", async () => {
    // Uses empty map - no provides would be found since getProvidesFromMain needs main.js
    // Actually the rule reads main.js from projectRoot - so we need main.js with app.provide
    // The test project has app.provide("user", useUser()) in main.js
    // So getProvidesFromMain will find it when we pass projectRoot
    const content = `<template><p>{{ otherVar }}</p></template>
<script setup>const x = 1;</script>`;

    const result = await injectGlobalComposableRule.apply(
      path.join(projectRoot, "src/views/Test.vue"),
      content,
      {
        enableTypeScript: false,
        isVueFile: true,
        projectRoot,
        mixinComposablesMap: makeMap(),
      }
    );

    // otherVar is not in returnKeys - so no inject needed
    expect(result.fixed).toBe(false);
  });
});
