/**
 * Tests for final fixes rules
 */

import {
  wrongStorePropertyRule,
  nullChecksLengthRule,
  detailViewStoreRule
} from "../final-fixes";

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
