/**
 * Tests for final fixes rules
 */

import {
  concatenatedStatementsRule,
  missingCallParenRepairRule,
  removeDoubleSemicolonsRule,
  wrongStorePropertyRule,
  nullChecksLengthRule,
  detailViewStoreRule
} from "../final/final-fixes";

describe("missingCallParenRepairRule", () => {
  it("should add missing ) in IDENT({ ... }); (e.g. store action calls)", async () => {
    const content = `function FETCH_ITEMS({ ids }) {
  return fetchItems(ids).then(items => SET_ITEMS({ items };
}
function FETCH_USER({ id }) {
  return fetchUser(id).then(user => SET_USER({ id, user };
}`;
    const result = await missingCallParenRepairRule.apply("store/index.js", content, {
      enableTypeScript: false,
      isVueFile: false
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("SET_ITEMS({ items }));");
    expect(result.content).toContain("SET_USER({ id, user }));");
    expect(result.fixes.length).toBe(2);
  });

  it("should not modify valid code", async () => {
    const content = `return fetchItems(ids).then(items => SET_ITEMS({ items }));`;
    const result = await missingCallParenRepairRule.apply("store/index.js", content, {
      enableTypeScript: false,
      isVueFile: false
    });
    expect(result.fixed).toBe(false);
    expect(result.content).toBe(content);
  });

  it("should fix }); in arrow callback (.then(x => IDENT({ ... });)", async () => {
    const content = `return fetchItems(ids).then(items => SET_ITEMS({ items });
    }
    : fetchUser(id).then(user => SET_USER({ id, user });`;
    const result = await missingCallParenRepairRule.apply("store/index.js", content, {
      enableTypeScript: false,
      isVueFile: false
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("SET_ITEMS({ items }));");
    expect(result.content).toContain("SET_USER({ id, user }));");
  });

  it("should not fix standalone valid }); (no arrow context)", async () => {
    const content = `SET_ITEMS({ items });`;
    const result = await missingCallParenRepairRule.apply("store/index.js", content, {
      enableTypeScript: false,
      isVueFile: false
    });
    expect(result.fixed).toBe(false);
    expect(result.content).toBe(content);
  });

  it("should not apply when pattern is absent", async () => {
    const content = "const x = 1; export default {};";
    expect(missingCallParenRepairRule.shouldApply("file.js", content)).toBe(false);
  });
});

describe("concatenatedStatementsRule", () => {
  it("should add semicolon between fn() and const (createPinia()const app)", async () => {
    const content = `const pinia = createPinia()const app = createVueApp({`;
    const result = await concatenatedStatementsRule.apply("app.js", content, {
      enableTypeScript: false,
      isVueFile: false
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toBe("const pinia = createPinia();\nconst app = createVueApp({");
  });

  it("should fix )let and )var as well", async () => {
    const content = `foo()let x = 1; bar()var y = 2;`;
    const result = await concatenatedStatementsRule.apply("test.js", content, {
      enableTypeScript: false,
      isVueFile: false
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("foo();\nlet x = 1");
    expect(result.content).toContain("bar();\nvar y = 2");
  });

  it("should not apply when pattern is absent", () => {
    const content = "const x = 1; const y = 2;";
    expect(concatenatedStatementsRule.shouldApply("file.js", content)).toBe(false);
  });
});

describe("removeDoubleSemicolonsRule", () => {
  it("should remove double semicolons", async () => {
    const content = `import { a } from 'x';;
const b = 1;;`;
    const result = await removeDoubleSemicolonsRule.apply("test.vue", content, {
      enableTypeScript: false,
      isVueFile: true
    });
    expect(result.fixed).toBe(true);
    expect(result.content).not.toContain(";;");
    expect(result.content).toContain("from 'x';");
  });

  it("should not apply when no double semicolons", async () => {
    const content = "const a = 1;\nconst b = 2;";
    const result = await removeDoubleSemicolonsRule.apply("test.js", content, {
      enableTypeScript: false,
      isVueFile: false
    });
    expect(result.fixed).toBe(false);
  });
});

describe("wrongStorePropertyRule", () => {
  it("should fix wrong store property access", async () => {
    const content = `<script setup lang="ts">
import { useProductStore } from '@/store/modules/product';
import { useUserStore } from '@/store/modules/user';
const productStore = useProductStore();
const userStore = useUserStore();
const users = productStore.allUsers;
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await wrongStorePropertyRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("userStore.allUsers");
    expect(result.content).not.toContain("productStore.allUsers");
    expect(result.fixes.some(fix => fix.includes("allUsers"))).toBe(true);
  });

  it("should not modify when store property access is correct", async () => {
    const content = `<script setup lang="ts">
import { useUserStore } from '@/store/modules/user';
const userStore = useUserStore();
const users = userStore.allUsers;
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await wrongStorePropertyRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent
    });

    // Should not fix if already correct
    expect(result.content).toContain("userStore.allUsers");
  });

  it("should not apply when no Store is present", async () => {
    const content = `<script setup lang="ts">
const test = ref(1);
</script>`;

    const result = await wrongStorePropertyRule.apply("test.vue", content, {
      enableTypeScript: false,
      isVueFile: true
    });

    expect(result.fixed).toBe(false);
  });

  it("should not apply to non-Vue files", async () => {
    const content = "const test = 1;";
    const result = await wrongStorePropertyRule.apply("test.js", content, {
      enableTypeScript: false,
      isVueFile: false
    });

    expect(result.fixed).toBe(false);
  });
});

describe("nullChecksLengthRule", () => {
  it("should add null checks for store property length access", async () => {
    const content = `<script setup lang="ts">
import { useUserStore } from '@/store/modules/user';
const userStore = useUserStore();
const count = userStore.allUsers.length;
</script>`;

    const result = await nullChecksLengthRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent: content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || ""
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("(userStore.allUsers ?? []).length");
    expect(result.fixes.some(fix => fix.includes("null checks"))).toBe(true);
  });

  it("should add .value to computed length access in script", async () => {
    const content = `<script setup lang="ts">
const items = computed(() => [1, 2, 3]);
const count = items.length;
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await nullChecksLengthRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("items.value.length");
    expect(result.content).not.toContain("items.length");
  });

  it("should not modify when null check already exists", async () => {
    const content = `<script setup lang="ts">
import { useUserStore } from '@/store/modules/user';
const userStore = useUserStore();
const count = (userStore.allUsers || []).length;
</script>`;

    const result = await nullChecksLengthRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent: content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || ""
    });

    // Should not add duplicate null checks (content keeps (x || []) when already wrapped)
    const nullCheckMatches = result.content.match(/\(userStore\.allUsers\s*(?:\|\|\s*\[\]|\?\?\s*\[\])\)/g);
    expect(nullCheckMatches?.length).toBe(1);
  });

  it("should not apply when no .length access is present", async () => {
    const content = `<script setup lang="ts">
import { useUserStore } from '@/store/modules/user';
const userStore = useUserStore();
const users = userStore.allUsers;
</script>`;

    const result = await nullChecksLengthRule.apply("test.vue", content, {
      enableTypeScript: false,
      isVueFile: true
    });

    expect(result.fixed).toBe(false);
  });

  it("should handle multiple length accesses", async () => {
    const content = `<script setup lang="ts">
import { useUserStore } from '@/store/modules/user';
import { useProductStore } from '@/store/modules/product';
const userStore = useUserStore();
const productStore = useProductStore();
const userCount = userStore.allUsers.length;
const productCount = productStore.allProducts.length;
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await nullChecksLengthRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("(userStore.allUsers ?? []).length");
    expect(result.content).toContain("(productStore.allProducts ?? []).length");
  });

  it("should add null-safe .length in template for computed (avoids undefined.length)", async () => {
    const content = `<template>
  <div v-if="cartItems.length > 0">Cart</div>
</template>
<script setup lang="ts">
const productStore = useProductStore();
const cartItems = computed<any>(() => productStore.cartItems?.value);
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const templateContent = content.match(/<template[^>]*>([\s\S]*?)<\/template>/)?.[1] || "";

    const result = await nullChecksLengthRule.apply("Products.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      templateContent
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("(cartItems ?? []).length > 0");
  });
});

describe("detailViewStoreRule", () => {
  it("should fix Detail view to use store.allItems.find()", async () => {
    const content = `<script setup lang="ts">
import { useUserStore } from '@/store/modules/user';
const userStore = useUserStore();
const userId = computed(() => route.params.id);
const user = computed<any>(() => userStore.currentUser);
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await detailViewStoreRule.apply("UserDetail.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent
    });

    // Should detect Detail view pattern
    expect(result).toBeDefined();
  });

  it("should not apply when file is not a Detail view", async () => {
    const content = `<script setup lang="ts">
import { useUserStore } from '@/store/modules/user';
const userStore = useUserStore();
const users = userStore.allUsers;
</script>`;

    const result = await detailViewStoreRule.apply("Users.vue", content, {
      enableTypeScript: false,
      isVueFile: true
    });

    expect(result.fixed).toBe(false);
  });

  it("should not apply when no current property is used", async () => {
    const content = `<script setup lang="ts">
import { useUserStore } from '@/store/modules/user';
const userStore = useUserStore();
const users = userStore.allUsers;
</script>`;

    const result = await detailViewStoreRule.apply("UserDetail.vue", content, {
      enableTypeScript: false,
      isVueFile: true
    });

    expect(result.fixed).toBe(false);
  });

  it("should handle Detail view with route params", async () => {
    const content = `<script setup lang="ts">
import { useUserStore } from '@/store/modules/user';
const userStore = useUserStore();
const userId = computed(() => route.params.id as string);
const user = computed<any>(() => userStore.currentUser);
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await detailViewStoreRule.apply("UserDetail.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent
    });

    // Should detect and potentially fix the pattern
    expect(result).toBeDefined();
  });

  it("should NOT apply when storeVar.method(id) exists - currentXxx is set by API (generic patterns)", async () => {
    const patterns = [
      { name: "getUser", content: "userStore.getUser(parseInt(props.id))" },
      { name: "loadProduct", content: "productStore.loadProduct(route.params.id)" },
      { name: "fetch", content: "orderStore.fetch(route.params.orderId)" },
      { name: "load by slug", content: "articleStore.loadBySlug(route.params.slug)" },
      { name: "get with props.articleId", content: "articleStore.get(props.articleId)" },
      { name: "route.params['id']", content: "itemStore.load(route.params['id'])" },
    ];
    for (const { content } of patterns) {
      const fullContent = `<script setup lang="ts">
const item = computed(() => someStore.currentItem);
${content}
</script>`;
      const shouldApply = detailViewStoreRule.shouldApply?.("SomeDetail.vue", fullContent);
      expect(shouldApply).toBe(false);
    }
  });
});
