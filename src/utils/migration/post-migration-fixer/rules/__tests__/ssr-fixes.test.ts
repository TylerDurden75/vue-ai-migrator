/**
 * Tests for SSR-specific fix rules
 */

import {
  ssrContextToInjectRule,
  asyncDataStoreDispatchRule,
  storeDispatchToDirectRule,
  barIndexStoreFixRule,
  storePiniaStateFixRule,
  onBeforeUnmountAddLetDeclarationRule,
  onBeforeUnmountOptionalChainingRule,
  watchListPropsGuardRule,
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
    it("fixes bar.indexStore.start() to bar.start()", async () => {
      const content = "bar.indexStore.start();";
      const result = await barIndexStoreFixRule.apply("ItemList.vue", content, { enableTypeScript: false, isVueFile: true });
      expect(result.fixed).toBe(true);
      expect(result.content).toBe("bar.start();");
    });
    it("fixes bar.store.finish() to bar.finish()", async () => {
      const content = "bar.store.finish();";
      const result = await barIndexStoreFixRule.apply("ProgressBar.vue", content, { enableTypeScript: false, isVueFile: true });
      expect(result.fixed).toBe(true);
      expect(result.content).toBe("bar.finish();");
    });
    it("fixes progressBar.store.start() (generic: any non-store varName)", async () => {
      const content = "progressBar.store.start();";
      const result = await barIndexStoreFixRule.apply("App.vue", content, { enableTypeScript: false, isVueFile: true });
      expect(result.fixed).toBe(true);
      expect(result.content).toBe("progressBar.start();");
    });
    it("does NOT fix store.indexStore (store-like: handled by storePiniaStateFixRule)", async () => {
      const content = "store.indexStore.fetchItem();";
      const result = await barIndexStoreFixRule.apply("ItemView.vue", content, { enableTypeScript: false, isVueFile: true });
      expect(result.fixed).toBe(false);
      expect(result.content).toBe("store.indexStore.fetchItem();");
    });
  });

  describe("storePiniaStateFixRule", () => {
    it("fixes store.indexStore to store", async () => {
      const content = "return store.indexStore.fetchItem(id);";
      const result = await storePiniaStateFixRule.apply("ItemView.vue", content, { enableTypeScript: false, isVueFile: true });
      expect(result.fixed).toBe(true);
      expect(result.content).toBe("return store.fetchItem(id);");
    });
    it("fixes store.state.items to store.items", async () => {
      const content = "const items = store.state.items;";
      const result = await storePiniaStateFixRule.apply("ItemList.vue", content, { enableTypeScript: false, isVueFile: true });
      expect(result.fixed).toBe(true);
      expect(result.content).toBe("const items = store.items;");
    });
  });
});
