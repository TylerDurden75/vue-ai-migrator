/**
 * Tests for SSR-specific fix rules
 */

import {
  ssrContextToInjectRule,
  mergeAsyncDataIntoDefineOptionsRule,
  asyncDataStoreDispatchRule,
  storeDispatchToDirectRule,
  barIndexStoreFixRule,
  storePiniaStateFixRule,
  onBeforeUnmountAddLetDeclarationRule,
  onBeforeUnmountOptionalChainingRule,
  watchListPropsGuardRule,
  listsPropsGuardRule,
  loadItemsRefValueRule,
  onBeforeMountFetchRouteDataRule,
  propsTypeFallbackForRouterLinkRule,
  entryServerResolveAsyncComponentsRule,
  entryServerRouterCurrentRouteRule,
  entryClientSyntaxRepairRule,
  defineOptionsTitleSetupRefRule,
  defineOptionsAsyncDataStoreRefRule,
} from "../ssr/ssr-fixes";

describe("ssr-fixes", () => {
  describe("ssrContextToInjectRule", () => {
    it("replaces this.$ssrContext with inject(ssrContext) in util/title.js", async () => {
      const content = `function getTitle (vm) {
  const { title } = vm.$options
  if (title) {
    return typeof title === 'function'
      ? title.call(vm)
      : title
  }
}

const serverTitleMixin = {
  created () {
    const title = getTitle(this)
    if (title) {
      this.$ssrContext.title = \`Vue HN 2.0 | \${title}\`
    }
  }
}

const clientTitleMixin = {
  mounted () {
    const title = getTitle(this)
    if (title) {
      document.title = \`Vue HN 2.0 | \${title}\`
    }
  }
}

export default import.meta.env.SSR
  ? serverTitleMixin
  : clientTitleMixin
`;

      const result = await ssrContextToInjectRule.apply(
        "src/util/title.js",
        content,
        {
          enableTypeScript: false,
          isVueFile: false,
        }
      );

      expect(result.fixed).toBe(true);
      expect(result.content).toContain("inject: { ssrContext: { from: 'ssrContext', default: null } }");
      expect(result.content).toContain("if (title && this.ssrContext)");
      expect(result.content).toContain("this.ssrContext.title =");
      expect(result.content).not.toContain("this.$ssrContext");
    });

    it("does not apply when file has no $ssrContext", async () => {
      const content = "const x = 1;";
      expect(ssrContextToInjectRule.shouldApply("src/util/title.js", content)).toBe(false);
    });

    it("does not apply to non-util paths without $ssrContext", async () => {
      expect(ssrContextToInjectRule.shouldApply("src/other.js", "this.$ssrContext")).toBe(false);
    });

    it("applies to util/ and utils/ paths", () => {
      const content = "this.$ssrContext.title = 'x'";
      expect(ssrContextToInjectRule.shouldApply("src/util/title.js", content)).toBe(true);
      expect(ssrContextToInjectRule.shouldApply("src/utils/title.js", content)).toBe(true);
    });

    it("does not add duplicate inject when already present", async () => {
      const content = `const serverTitleMixin = {
  inject: { ssrContext: { from: 'ssrContext', default: null } },
  created () {
    if (title && this.ssrContext) {
      this.ssrContext.title = 'x'
    }
  }
}`;
      const result = await ssrContextToInjectRule.apply("src/util/title.js", content, {
        enableTypeScript: false,
        isVueFile: false,
      });
      expect(result.fixed).toBe(false);
    });
  });

  describe("storeDispatchToDirectRule", () => {
    it("replaces store.dispatch with direct method call in any function", async () => {
      const content = `function doFetchComments(store, item) {
  return store.dispatch("FETCH_ITEMS", { ids: item.kids })
    .then(() => Promise.all(item.kids.map(id => doFetchComments(store, store.state.items[id]))));
}`;
      const result = await storeDispatchToDirectRule.apply("ItemView.vue", content, {
        enableTypeScript: false,
        isVueFile: true,
      });
      expect(result.fixed).toBe(true);
      expect(result.content).toContain("store.FETCH_ITEMS({ ids: item.kids })");
      expect(result.content).not.toContain('store.dispatch("FETCH_ITEMS"');
    });

    it("does NOT replace storeVar.dispatch('module/action') - handled by storeDispatchModuleActionRule", async () => {
      const content = `indexStore.dispatch('user/fetchUsers');`;
      const result = await storeDispatchToDirectRule.apply("Users.vue", content, {
        enableTypeScript: false,
        isVueFile: true,
      });
      expect(result.fixed).toBe(false);
      expect(result.content).toContain("indexStore.dispatch");
    });
  });

  describe("onBeforeUnmountAddLetDeclarationRule", () => {
    it("adds let declaration when unwatchList is used without declaration", async () => {
      const content = `<script setup>
onBeforeMount(() => {
  unwatchList = watchList(props.type, () => {});
});
onBeforeUnmount(() => {
  unwatchList();
});
</script>`;
      const result = await onBeforeUnmountAddLetDeclarationRule.apply("ItemList.vue", content, {
        enableTypeScript: false,
        isVueFile: true,
      });
      expect(result.fixed).toBe(true);
      expect(result.content).toContain("let unwatchList;");
    });
  });

  describe("onBeforeUnmountOptionalChainingRule", () => {
    it("adds optional chaining when let var is called in onBeforeUnmount", async () => {
      const content = `<script setup>
let unwatchList;
onBeforeMount(() => {
  if (!props.type) return;
  unwatchList = watchList(props.type, () => {});
});
onBeforeUnmount(() => {
  unwatchList();
});
</script>`;
      const result = await onBeforeUnmountOptionalChainingRule.apply("ItemList.vue", content, {
        enableTypeScript: false,
        isVueFile: true,
      });
      expect(result.fixed).toBe(true);
      expect(result.content).toContain("unwatchList?.()");
    });
  });

  describe("watchListPropsGuardRule", () => {
    it("adds guard before watchList(props.type)", async () => {
      const content = `<script setup>
onBeforeMount(() => {
  loadItems(page.value, -1);
  unwatchList = watchList(props.type, ids => {});
});
</script>`;
      const result = await watchListPropsGuardRule.apply("ItemList.vue", content, {
        enableTypeScript: false,
        isVueFile: true,
      });
      expect(result.fixed).toBe(true);
      expect(result.content).toContain("if (!props.type) return;");
    });
  });

  describe("mergeAsyncDataIntoDefineOptionsRule", () => {
    it("merges second script block (asyncData) into script setup via defineOptions", async () => {
      const content = `<template><div>{{ user?.id }}</div></template>

<script setup>
const user = computed(() => store.users[route.params.id]);
</script>

<script>
export default {
  asyncData({ store, route }) {
    return store.FETCH_USER({ id: route.params.id });
  }
};
</script>`;
      const result = await mergeAsyncDataIntoDefineOptionsRule.apply("UserView.vue", content, {
        enableTypeScript: false,
        isVueFile: true,
        scriptContent: "",
        templateContent: "",
        astCache: { get: () => ({}), update: () => {} } as any,
        projectRoot: undefined,
        fixerRulesDisable: undefined,
        fixerRulesEnable: undefined,
      });
      expect(result.fixed).toBe(true);
      expect(result.content).toContain("defineOptions({");
      expect(result.content).toContain("asyncData({ store, route })");
      expect(result.content).toContain("store.FETCH_USER({ id: route.params.id })");
      expect(result.content).not.toMatch(/<script>\s*export\s+default/);
    });
  });

  describe("asyncDataStoreDispatchRule", () => {
    it("replaces store.dispatch with direct method call", async () => {
      const content = `asyncData({ store, route }) {
  return store.dispatch('fetchItems', route.params.type);
}`;
      const result = await asyncDataStoreDispatchRule.apply("ItemList.vue", content, {
        enableTypeScript: false,
        isVueFile: true,
      });
      expect(result.fixed).toBe(true);
      expect(result.content).toContain("store.fetchItems(route.params.type)");
    });
  });

  describe("barIndexStoreFixRule", () => {
    it("fixes bar.indexStore.start() to bar?.start?.() (optional chaining - bar can be undefined)", async () => {
      const content = "bar.indexStore.start();";
      const result = await barIndexStoreFixRule.apply("ItemList.vue", content, { enableTypeScript: false, isVueFile: true });
      expect(result.fixed).toBe(true);
      expect(result.content).toBe("bar?.start?.();");
    });
    it("fixes bar.store.finish() to bar?.finish?.()", async () => {
      const content = "bar.store.finish();";
      const result = await barIndexStoreFixRule.apply("ProgressBar.vue", content, { enableTypeScript: false, isVueFile: true });
      expect(result.fixed).toBe(true);
      expect(result.content).toBe("bar?.finish?.();");
    });
    it("fixes progressBar.store.start() (generic: any non-store varName) with optional chaining", async () => {
      const content = "progressBar.store.start();";
      const result = await barIndexStoreFixRule.apply("App.vue", content, { enableTypeScript: false, isVueFile: true });
      expect(result.fixed).toBe(true);
      expect(result.content).toBe("progressBar?.start?.();");
    });
    it("does NOT fix store.indexStore (store-like: handled by storePiniaStateFixRule)", async () => {
      const content = "store.indexStore.fetchItem();";
      const result = await barIndexStoreFixRule.apply("ItemView.vue", content, { enableTypeScript: false, isVueFile: true });
      expect(result.fixed).toBe(false);
      expect(result.content).toBe("store.indexStore.fetchItem();");
    });
    it("detects plugin var from getCurrentInstance (custom name loadingBar)", async () => {
      const content = `<script setup>
const loadingBar = getCurrentInstance()?.appContext.config.globalProperties.$loadingBar;
loadingBar.indexStore.start();
</script>`;
      const result = await barIndexStoreFixRule.apply("App.vue", content, { enableTypeScript: false, isVueFile: true });
      expect(result.fixed).toBe(true);
      expect(result.content).toContain("loadingBar?.start?.()");
      expect(result.content).not.toContain("loadingBar.indexStore");
    });
  });

  describe("storePiniaStateFixRule", () => {
    it("fixes store.indexStore to store", async () => {
      const content = "return store.indexStore.fetchItem(id);";
      const result = await storePiniaStateFixRule.apply("ItemView.vue", content, { enableTypeScript: false, isVueFile: true });
      expect(result.fixed).toBe(true);
      expect(result.content).toBe("return store.fetchItem(id);");
    });
    it("fixes store.indexStore.FETCH_USER (asyncData pattern)", async () => {
      const content = `asyncData({ store, route: { params: { id } } }) {
    return store.indexStore.FETCH_USER({ id });
  }`;
      const result = await storePiniaStateFixRule.apply("UserView.vue", content, { enableTypeScript: false, isVueFile: true });
      expect(result.fixed).toBe(true);
      expect(result.content).toContain("return store.FETCH_USER({ id });");
    });
    it("fixes store.indexStore with multiline (doFetchComments pattern)", async () => {
      const content = `return store.indexStore
      .FETCH_ITEMS({ ids: item.kids })`;
      const result = await storePiniaStateFixRule.apply("ItemView.vue", content, { enableTypeScript: false, isVueFile: true });
      expect(result.fixed).toBe(true);
      expect(result.content).toContain("return store\n      .FETCH_ITEMS");
    });
    it("fixes store.state.items to store.items", async () => {
      const content = "const items = store.state.items;";
      const result = await storePiniaStateFixRule.apply("ItemList.vue", content, { enableTypeScript: false, isVueFile: true });
      expect(result.fixed).toBe(true);
      expect(result.content).toBe("const items = store.items;");
    });
  });

  describe("listsPropsGuardRule", () => {
    it("adds ?? [] for storeVar.lists[props.X] (conventional)", async () => {
      const content = `<template>{{ store.lists[props.type].length }}</template><script setup>
const props = defineProps({ type: String });
const store = useStore();
</script>`;
      const result = await listsPropsGuardRule.apply("List.vue", content, { enableTypeScript: false, isVueFile: true });
      expect(result.fixed).toBe(true);
      expect(result.content).toContain("(store.lists[props.type] ?? []).length");
    });
    it("adds ?? [] for storeVar.categories[props.slug] (generic property)", async () => {
      const content = `const len = store.categories[props.slug].length;`;
      const result = await listsPropsGuardRule.apply("Category.vue", content, { enableTypeScript: false, isVueFile: true });
      expect(result.fixed).toBe(true);
      expect(result.content).toContain("(store.categories[props.slug] ?? []).length");
    });
  });

  describe("loadItemsRefValueRule", () => {
    it("fixes loadItems(page) → loadItems(page.value) when page is computed", async () => {
      const content = `<script setup>
const page = computed(() => Number(route.params.page) || 1);
onBeforeMount(() => {
  loadItems(page);
});
</script>`;
      const result = await loadItemsRefValueRule.apply("ItemList.vue", content, {
        enableTypeScript: false,
        isVueFile: true,
      });
      expect(result.fixed).toBe(true);
      expect(result.content).toContain("loadItems(page.value)");
    });
    it("fixes fetchData(page) and loadPage(id) (generic pattern)", async () => {
      const content = `<script setup>
const page = ref(1);
const id = computed(() => route.params.id);
onBeforeMount(() => { fetchData(page); loadPage(id); });
</script>`;
      const result = await loadItemsRefValueRule.apply("List.vue", content, {
        enableTypeScript: false,
        isVueFile: true,
      });
      expect(result.fixed).toBe(true);
      expect(result.content).toContain("fetchData(page.value)");
      expect(result.content).toContain("loadPage(id.value)");
    });
    it("fixes doFetchComments(indexStore, item) when item is computed", async () => {
      const content = `<script setup>
const item = computed(() => store.items[route.params.id]);
onBeforeMount(() => { doFetchComments(indexStore, item); });
</script>`;
      const result = await loadItemsRefValueRule.apply("ItemView.vue", content, {
        enableTypeScript: false,
        isVueFile: true
      });
      expect(result.fixed).toBe(true);
      expect(result.content).toContain("doFetchComments(indexStore, item.value)");
    });
    it("does NOT replace item in function param: function doFetchComments(store, item)", async () => {
      const content = `<script setup>
const item = computed(() => store.items[route.params.id]);
function doFetchComments(store, item) {
  if (item && item.kids) return store.FETCH_ITEMS({ ids: item.kids });
}
onBeforeMount(() => { doFetchComments(indexStore, item); });
</script>`;
      const result = await loadItemsRefValueRule.apply("ItemView.vue", content, {
        enableTypeScript: false,
        isVueFile: true,
      });
      expect(result.fixed).toBe(true);
      expect(result.content).toContain("function doFetchComments(store, item)");
      expect(result.content).not.toContain("function doFetchComments(store, item.value)");
      expect(result.content).toContain("doFetchComments(indexStore, item.value)");
    });
    it("does not double-add .value when already present", async () => {
      const content = `<script setup>
const page = computed(() => 1);
onBeforeMount(() => { loadItems(page.value); });
</script>`;
      const result = await loadItemsRefValueRule.apply("ItemList.vue", content, {
        enableTypeScript: false,
        isVueFile: true,
      });
      expect(result.fixed).toBe(false);
      expect(result.content).toContain("loadItems(page.value)");
    });
  });

  describe("onBeforeMountFetchRouteDataRule", () => {
    it("replaces onBeforeMount(fetchComments) with watch when fetchComments uses store[route.params.id]", async () => {
      const content = `<script setup>
import { useRoute } from "vue-router";
import { useIndexStore } from "@/store";
const route = useRoute();
const indexStore = useIndexStore();
const item = computed(() => indexStore.items[route.params.id]);
const fetchComments = () => {
  const data = item.value;
  if (!data?.kids) return;
  doFetchComments(indexStore, data);
};
onBeforeMount(() => { fetchComments(); });
defineOptions({ asyncData({ store, route }) { return store.FETCH_ITEMS({ ids: [route.params.id] }); } });
</script>`;
      const result = await onBeforeMountFetchRouteDataRule.apply("ItemView.vue", content, {
        enableTypeScript: false,
        isVueFile: true,
      });
      expect(result.fixed).toBe(true);
      expect(result.content).not.toContain("onBeforeMount(() => { fetchComments(); })");
      expect(result.content).toContain("watch(");
      expect(result.content).toMatch(/watch\s*\(\s*\(\)\s*=>\s*item\.value/);
      expect(result.content).toContain("if (v) fetchComments();");
    });
    it("does not apply when watch on dataVar already exists", async () => {
      const content = `<script setup>
const route = useRoute();
const item = computed(() => store.items[route.params.id]);
watch(() => item.value, () => fetchComments(), { immediate: true });
onBeforeMount(() => { fetchComments(); });
</script>`;
      expect(onBeforeMountFetchRouteDataRule.shouldApply("ItemView.vue", content)).toBe(false);
    });
  });

  describe("propsTypeFallbackForRouterLinkRule", () => {
    it("adds typeResolved computed (generic) for any prop in router-link path", async () => {
      const content = `<template>
<div>
  <router-link v-if="hasMore" :to="'/' + type + '/' + (page + 1)">more</router-link>
</div>
</template>

<script setup>
const props = defineProps({ type: String });
import { useIndexStore } from '@/store';
const indexStore = useIndexStore();
const page = 1;
const hasMore = indexStore.lists[props.type]?.length > 20;
</script>`;
      const result = await propsTypeFallbackForRouterLinkRule.apply(
        "ItemList.vue",
        content,
        { enableTypeScript: false, isVueFile: true }
      );
      expect(result.fixed).toBe(true);
      expect(result.content).toContain("typeResolved");
      expect(result.content).toMatch(/\.path\.split\('\/'\)\.filter\(Boolean\)\[0\]/);
      expect(result.content).toContain(":to=\"'/' + typeResolved + '/' + (page + 1)\"");
      expect(result.content).toContain("indexStore.lists[typeResolved.value]");
    });
    it("works with any prop name (category, section, etc.)", async () => {
      const content = `<template>
<router-link :to="'/' + category + '/' + page">link</router-link>
</template>
<script setup>
const props = defineProps({ category: String });
const route = useRoute();
const page = 1;
</script>`;
      const result = await propsTypeFallbackForRouterLinkRule.apply(
        "CategoryView.vue",
        content,
        { enableTypeScript: false, isVueFile: true }
      );
      expect(result.fixed).toBe(true);
      expect(result.content).toContain("categoryResolved");
      expect(result.content).toContain("'/' + categoryResolved + '/'");
    });
    it("does not apply when XResolved already exists", () => {
      const content = `<template><router-link :to="'/' + type + '/'"></router-link></template>
<script setup>
const props = defineProps({ type: String });
const typeResolved = computed(() => props.type ?? 'default');
</script>`;
      expect(propsTypeFallbackForRouterLinkRule.shouldApply("ItemList.vue", content)).toBe(false);
    });
  });

  describe("entryServerResolveAsyncComponentsRule", () => {
    it("resolves async route components before calling asyncData", async () => {
      const content = `router.isReady().then(() => {
      const matchedComponents = router.currentRoute.value.matched
        .map(m => m.components?.default)
        .filter(Boolean);
      if (!matchedComponents.length) return reject({ code: 404 });
      Promise.all(matchedComponents.map(({ asyncData }) => asyncData && asyncData({ store, route })))
        .then(() => resolve(app)).catch(reject);
    }, reject);`;
      const result = await entryServerResolveAsyncComponentsRule.apply(
        "src/entry-server.js",
        content,
        { enableTypeScript: false, isVueFile: false }
      );
      expect(result.fixed).toBe(true);
      expect(result.content).toContain("router.isReady().then(async () => {");
      expect(result.content).toContain("typeof c === 'function'");
      expect(result.content).toContain("rawComponents");
      expect(result.content).toContain("x?.default ?? x");
    });
    it("does not apply when resolution logic already present", () => {
      const content = `router.isReady().then(async () => {
      const rawComponents = router.currentRoute.value.matched.map(m => m.components?.default).filter(Boolean);
      const matchedComponents = (await Promise.all(rawComponents.map(c => {
        if (typeof c === 'function') return c().then(x => x?.default ?? x);
        return Promise.resolve(c);
      }))).filter(Boolean);
      ...
    });`;
      expect(entryServerResolveAsyncComponentsRule.shouldApply("entry-server.js", content)).toBe(false);
    });
  });

  describe("entryServerRouterCurrentRouteRule", () => {
    it("fixes route: router.currentRoute to router.currentRoute.value in entry-server", async () => {
      const content = `Promise.all(matchedComponents.map(({ asyncData }) => asyncData && asyncData({
        store,
        route: router.currentRoute
      }))).then(() => { ... });`;
      const result = await entryServerRouterCurrentRouteRule.apply("src/entry-server.js", content, { enableTypeScript: false, isVueFile: false });
      expect(result.fixed).toBe(true);
      expect(result.content).toContain("route: router.currentRoute.value");
      expect(result.content).not.toMatch(/route:\s*router\.currentRoute(?!\.value)/);
    });
    it("does not apply when currentRoute.value already used", async () => {
      const content = "route: router.currentRoute.value";
      expect(entryServerRouterCurrentRouteRule.shouldApply("entry-server.js", content)).toBe(false);
    });
  });

  describe("entryClientSyntaxRepairRule", () => {
    it("fixes globalProperties.$bar = createApp to = bar", async () => {
      const content = `import { createApp } from 'vue';
import { createApp as createAppFactory } from './app';
const bar = createApp(ProgressBar).mount(document.createElement('div'));
const { app, router } = createAppFactory(null, { initialState: window.__INITIAL_STATE__ })
app.config.globalProperties.$bar = createApp
)
      .then(() => { bar.finish(); next() })
      .catch(next)
  })
  app.mount('#app')
})`;
      expect(entryClientSyntaxRepairRule.shouldApply("entry-client.js", content)).toBe(true);
      const result = await entryClientSyntaxRepairRule.apply("entry-client.js", content, {
        enableTypeScript: false,
        isVueFile: false,
      });
      expect(result.fixed).toBe(true);
      expect(result.content).toContain("app.config.globalProperties.$bar = bar");
      expect(result.content).not.toContain("$bar = createApp");
    });

    it("restores broken router.isReady/beforeResolve structure", async () => {
      const content = `const bar = createApp(ProgressBar).mount(document.createElement('div'));
const { app, router, store, pinia } = createAppFactory(null, { initialState: window.__INITIAL_STATE__ })
app.config.globalProperties.$bar = bar

)
      .then(() => {
        bar.finish()
        next()
      })
      .catch(next)
  })

  // actually mount to DOM
  app.mount('#app')
})`;
      const result = await entryClientSyntaxRepairRule.apply("entry-client.js", content, {
        enableTypeScript: false,
        isVueFile: false,
      });
      expect(result.fixed).toBe(true);
      expect(result.content).toContain("router.isReady().then");
      expect(result.content).toContain("router.beforeResolve");
      expect(result.content).toContain("bar.start?.()");
      expect(result.content).not.toMatch(/\n\)\s*\n\s+\.then/);
    });

    it("does not apply when entry-client is already correct", async () => {
      const content = `app.config.globalProperties.$bar = bar
router.isReady().then(() => { app.mount('#app') })`;
      expect(entryClientSyntaxRepairRule.shouldApply("entry-client.js", content)).toBe(false);
    });
  });

  describe("defineOptionsAsyncDataStoreRefRule", () => {
    it("replaces indexStore with store and adds store to params when missing", async () => {
      const content = `<script setup>
import { useIndexStore } from "@/store/index";
const indexStore = useIndexStore();
defineOptions({
  asyncData({ route }) {
    return indexStore.FETCH_USER({ id: route.params.id });
  },
});
</script>`;
      const result = await defineOptionsAsyncDataStoreRefRule.apply("UserView.vue", content, {
        enableTypeScript: false,
        isVueFile: true,
      });
      expect(result.fixed).toBe(true);
      expect(result.content).toMatch(/asyncData\s*\(\s*\{\s*store\s*,\s*route\s*\}\s*\)/);
      expect(result.content).toContain("return store.FETCH_USER({ id: route.params.id })");
      expect(result.content).not.toContain("indexStore.FETCH_USER");
    });

    it("replaces indexStore with store when store already in params", async () => {
      const content = `<script setup>
import { useIndexStore } from "@/store/index";
const indexStore = useIndexStore();
defineOptions({
  asyncData({ store, route }) {
    return indexStore.FETCH_ITEMS({ ids: [route.params.id] });
  },
});
</script>`;
      const result = await defineOptionsAsyncDataStoreRefRule.apply("ItemView.vue", content, {
        enableTypeScript: false,
        isVueFile: true,
      });
      expect(result.fixed).toBe(true);
      expect(result.content).toContain("return store.FETCH_ITEMS({ ids: [route.params.id] })");
      expect(result.content).not.toContain("indexStore.FETCH_ITEMS");
    });
  });

  describe("defineOptionsTitleSetupRefRule", () => {
    it("removes title() from defineOptions and adds watch when title references item.value", async () => {
      const content = `<template><div>{{ item?.title }}</div></template>
<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
defineOptions({
  asyncData({ store, route: r }) { return store.FETCH_ITEMS({ ids: [r.params.id] }); },
  title() { return item.value.title; },
});
const route = useRoute();
const item = computed(() => store.items[route.params.id]);
</script>`;
      expect(defineOptionsTitleSetupRefRule.shouldApply("ItemView.vue", content)).toBe(true);
      const result = await defineOptionsTitleSetupRefRule.apply("ItemView.vue", content, {
        enableTypeScript: false,
        isVueFile: true,
      });
      expect(result.fixed).toBe(true);
      expect(result.content).not.toContain("title() { return item.value.title");
      expect(result.content).toContain("watch(");
      expect(result.content).toMatch(/\(\)\s*=>\s*item\?+\.value\?\.title/);
    });

    it("handles user ? user.id : 'User not found' pattern (ternary without .value)", async () => {
      const content = `<template><div v-if="user">{{ user.id }}</div></template>
<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useIndexStore } from "@/store/index";
defineOptions({
  asyncData({ store, route: r }) { return store.FETCH_USER({ id: r.params.id }); },
  title() { return user ? user.id : "User not found"; },
});
const store = useIndexStore();
const route = useRoute();
const user = computed(() => store.users[route.params.id] ?? null);
</script>`;
      expect(defineOptionsTitleSetupRefRule.shouldApply("UserView.vue", content)).toBe(true);
      const result = await defineOptionsTitleSetupRefRule.apply("UserView.vue", content, {
        enableTypeScript: false,
        isVueFile: true,
      });
      expect(result.fixed).toBe(true);
      expect(result.content).not.toContain("title() { return user ? user.id");
      expect(result.content).toContain("(user?.value && typeof user.value === \"object\") ? user.value.id : user?.value === false ? \"User not found\" : null");
      expect(result.content).toContain("watch(");
    });
  });
});
