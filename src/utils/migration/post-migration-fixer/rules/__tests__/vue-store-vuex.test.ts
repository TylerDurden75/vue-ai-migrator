/**
 * Tests for vue-store-vuex rule (this.$store.getters / dispatch → Pinia)
 */

import { vueStoreVuexToPiniaRule } from "../store/vue-store-vuex";

describe("vueStoreVuexToPiniaRule", () => {
  it("should replace this.$store.getters['module/getter'] and dispatch('module/action')", async () => {
    const content = `<template><div>{{ userCount }}</div></template>
<script setup lang="ts">
import { computed } from "vue";
const userCount = computed<any>(() => this.$store.getters['user/allUsers'].length);
const changeTheme = event => {
  this.$store.dispatch('app/setTheme', event.target.value);
};
</script>`;

    const result = await vueStoreVuexToPiniaRule.apply("src/views/Dashboard.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      projectRoot: undefined,
      scriptContent: ""
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("userStore.allUsers");
    expect(result.content).toContain("appStore.setTheme(event.target.value)");
    expect(result.content).not.toContain("this.$store");
    expect(result.content).toContain("import { useUserStore } from '@/store/modules/user'");
    expect(result.content).toContain("import { useAppStore } from '@/store/modules/app'");
    expect(result.content).toContain("const userStore = useUserStore()");
    expect(result.content).toContain("const appStore = useAppStore()");
  });

  it("should handle dispatch with multi-line args", async () => {
    const content = `<script setup>
this.$store.dispatch('user/setFilter', {
  key: 'search',
  value: q
});
</script>`;

    const result = await vueStoreVuexToPiniaRule.apply("src/views/Users.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
      scriptContent: ""
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("userStore.setFilter({");
    expect(result.content).toContain("key: 'search'");
    expect(result.content).toContain("value: q");
    expect(result.content).not.toContain("this.$store");
  });

  it("should replace this.$store.state.items with indexStore.items", async () => {
    const content = `<script setup>
const comment = computed(() => this.$store.state.items[props.id]);
</script>`;

    const result = await vueStoreVuexToPiniaRule.apply("src/components/Comment.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
      scriptContent: "",
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("indexStore.items");
    expect(result.content).not.toContain("this.$store");
    expect(result.content).toContain("import { useIndexStore } from");
    expect(result.content).toContain("const indexStore = useIndexStore()");
  });
});
