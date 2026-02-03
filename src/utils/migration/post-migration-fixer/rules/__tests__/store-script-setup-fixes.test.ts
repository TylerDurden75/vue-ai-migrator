/**
 * Tests for store-script-setup-related rules
 */

import {
  storeScriptSetupRule,
  secureRouterPushRule,
  routerPushTypeCheckRule,
  replaceThisRouterRouteRule,
  fixStoreMemberMismatchRule
} from "../store-script-setup-fixes";
import type { FixContext } from "../../types";
import * as path from "path";

jest.mock("../../utils/store-analysis-cache", () => ({
  getStoreMethodMap: jest.fn()
}));
import { getStoreMethodMap } from "../../utils/store-analysis-cache";

const mockGetStoreMethodMap = getStoreMethodMap as jest.MockedFunction<typeof getStoreMethodMap>;

describe("storeScriptSetupRule", () => {
  it("should detect this. references in script setup", async () => {
    const content = `<script setup lang="ts">
const userStore = useUserStore();
const users = this.getUsers();
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await storeScriptSetupRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent
    });

    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some(issue => issue.includes("this."))).toBe(true);
  });

  it("should detect multiple this. references", async () => {
    const content = `<script setup lang="ts">
const userStore = useUserStore();
const users = this.getUsers();
const currentUser = this.getCurrentUser();
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await storeScriptSetupRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent
    });

    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some(issue => issue.includes("this."))).toBe(true);
  });

  it("should not apply when no this. references are present", async () => {
    const content = `<script setup lang="ts">
const userStore = useUserStore();
const users = userStore.getUsers();
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await storeScriptSetupRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent
    });

    expect(result.issues.length).toBe(0);
  });

  it("should not apply when script content is missing", async () => {
    const content = `<template>
  <div>Test</div>
</template>`;

    const result = await storeScriptSetupRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });

    expect(result.fixed).toBe(false);
  });

  it("should not apply to non-Vue files", async () => {
    const content = `const test = this.getUsers();`;

    const result = await storeScriptSetupRule.apply("test.ts", content, {
      enableTypeScript: false,
      isVueFile: false
    });

    expect(result.fixed).toBe(false);
  });

  it("should not apply when file does not have script setup", async () => {
    const content = `<script lang="ts">
export default {
  methods: {
    getUsers() {
      return this.users;
    }
  }
}
</script>`;

    const result = await storeScriptSetupRule.apply("test.vue", content, {
      enableTypeScript: false,
      isVueFile: true
    });

    expect(result.fixed).toBe(false);
  });
});

describe("secureRouterPushRule", () => {
  it("should secure router.push with params fallback", async () => {
    const content = `<script setup lang="ts">
const router = useRouter();
const goToUser = (id: string | undefined) => {
  router.push({ name: 'user', params: { id } });
};
</script>`;

    const result = await secureRouterPushRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("id: id || ''");
    expect(result.fixes.some(fix => fix.includes("router.push"))).toBe(true);
  });

  it("should handle router.push with multiple params", async () => {
    const content = `<script setup lang="ts">
const router = useRouter();
const goToUser = (id: string | undefined, type: string | undefined) => {
  router.push({ name: 'user', params: { id: id, type: type } });
};
</script>`;

    const result = await secureRouterPushRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("id: id || ''");
    expect(result.content).toContain("type: type || ''");
  });

  it("should secure generic param names (slug, userId, etc.)", async () => {
    const content = `<script setup lang="ts">
const router = useRouter();
const go = (slug: string | undefined) => {
  router.push({ name: 'post', params: { slug } });
};
</script>`;

    const result = await secureRouterPushRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("slug: slug || ''");
  });

  it("should not modify when params already have fallback", async () => {
    const content = `<script setup lang="ts">
const router = useRouter();
const goToUser = (id: string | undefined) => {
  router.push({ name: 'user', params: { id: id || '' } });
};
</script>`;

    const result = await secureRouterPushRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });

    // Should not add duplicate fallback
    const fallbackMatches = result.content.match(/id:\s*id\s*\|\|\s*''/g);
    expect(fallbackMatches?.length).toBe(1);
  });

  it("should not modify when params use optional chaining", async () => {
    const content = `<script setup lang="ts">
const router = useRouter();
const goToUser = (id: string | undefined) => {
  router.push({ name: 'user', params: { id: id ?? '' } });
};
</script>`;

    const result = await secureRouterPushRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });

    // Should not modify when using nullish coalescing
    expect(result.content).toContain("id: id ?? ''");
  });

  it("should not apply when router.push is not present", async () => {
    const content = `<script setup lang="ts">
const router = useRouter();
const goToUser = () => {
  router.replace({ name: 'user' });
};
</script>`;

    const result = await secureRouterPushRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });

    expect(result.fixed).toBe(false);
  });

  it("should not apply when params are not present", async () => {
    const content = `<script setup lang="ts">
const router = useRouter();
const goToUser = () => {
  router.push({ name: 'user' });
};
</script>`;

    const result = await secureRouterPushRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });

    expect(result.fixed).toBe(false);
  });

  it("should handle router.push with complex params object", async () => {
    const content = `<script setup lang="ts">
const router = useRouter();
const goToUser = (id: string | undefined) => {
  router.push({
    name: 'user',
    params: {
      id
    }
  });
};
</script>`;

    const result = await secureRouterPushRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("id: id || ''");
  });
});

describe("routerPushTypeCheckRule", () => {
  it("should add type assertion for router.push route name when TypeScript is enabled", async () => {
    const content = `<script setup lang="ts">
const router = useRouter();
const goToUser = () => {
  router.push({ name: 'user' });
};
</script>`;

    const result = await routerPushTypeCheckRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("name: 'user' as string");
    expect(result.fixes.some(fix => fix.includes("router.push"))).toBe(true);
  });

  it("should not apply when TypeScript is disabled", async () => {
    const content = `<script setup>
const router = useRouter();
const goToUser = () => {
  router.push({ name: 'user' });
};
</script>`;

    const result = await routerPushTypeCheckRule.apply("test.vue", content, {
      enableTypeScript: false,
      isVueFile: true
    });

    expect(result.fixed).toBe(false);
  });

  it("should not modify when type assertion already exists", async () => {
    const content = `<script setup lang="ts">
const router = useRouter();
const goToUser = () => {
  router.push({ name: 'user' as string });
};
</script>`;

    const result = await routerPushTypeCheckRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });

    // Should not add duplicate type assertion
    const typeAssertionMatches = result.content.match(/name:\s*'user'\s*as\s*string/g);
    expect(typeAssertionMatches?.length).toBe(1);
  });

  it("should handle multiple router.push calls", async () => {
    const content = `<script setup lang="ts">
const router = useRouter();
const goToUser = () => {
  router.push({ name: 'user' });
};
const goToProduct = () => {
  router.push({ name: 'product' });
};
</script>`;

    const result = await routerPushTypeCheckRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("name: 'user' as string");
    expect(result.content).toContain("name: 'product' as string");
    expect(result.fixes.length).toBeGreaterThanOrEqual(2);
  });

  it("should handle router.push with double quotes", async () => {
    const content = `<script setup lang="ts">
const router = useRouter();
const goToUser = () => {
  router.push({ name: "user" });
};
</script>`;

    const result = await routerPushTypeCheckRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain('name: "user" as string');
  });

  it("should not apply when router.push is not present", async () => {
    const content = `<script setup lang="ts">
const router = useRouter();
const goToUser = () => {
  router.replace({ name: 'user' });
};
</script>`;

    const result = await routerPushTypeCheckRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });

    expect(result.fixed).toBe(false);
  });

  it("should handle router.push without name property", async () => {
    const content = `<script setup lang="ts">
const router = useRouter();
const goToUser = () => {
  router.push({ path: '/user' });
};
</script>`;

    const result = await routerPushTypeCheckRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });

    // Should not apply when name is not present
    expect(result.fixed).toBe(false);
  });
});

describe("replaceThisRouterRouteRule", () => {
  it("should replace this.$router with useRouter() and add import", async () => {
    const content = `<script setup lang="ts">
this.$router.push('/');
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
    const result = await replaceThisRouterRouteRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("import { useRouter } from 'vue-router'");
    expect(result.content).toContain("const router = useRouter()");
    expect(result.content).toContain("router.push");
    expect(result.content).not.toContain("this.$router");
  });

  it("should replace this.$route with useRoute() and add import", async () => {
    const content = `<script setup lang="ts">
const id = this.$route.params.id;
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
    const result = await replaceThisRouterRouteRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("import { useRoute } from 'vue-router'");
    expect(result.content).toContain("const route = useRoute()");
    expect(result.content).toContain("route.params.id");
    expect(result.content).not.toContain("this.$route");
  });

  it("should not apply when no this.$router or this.$route", async () => {
    const content = `<script setup lang="ts">const x = 1;</script>`;
    const result = await replaceThisRouterRouteRule.apply("test.vue", content, {
      enableTypeScript: false,
      isVueFile: true
    });
    expect(result.fixed).toBe(false);
  });
});

describe("fixStoreMemberMismatchRule", () => {
  const testProjectRoot = path.join(__dirname, "../../../../test-project");

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreMethodMap.mockResolvedValue({
      fetchUser: "user",
      allUsers: "user",
      currentUser: "user",
      isLoading: "index",
      loading: "index",
      fetchCurrentUser: "index"
    });
  });

  it("should fix indexStore.fetchUser and indexStore.allIndexs to userStore", async () => {
    const content = `<script setup lang="ts">
import { computed, watch } from "vue";
import { useIndexStore } from "@/store/index";
import { useRoute } from "vue-router";

const route = useRoute();
const indexStore = useIndexStore();
const props = defineProps({ id: { type: [String, Number], required: true } });

const isLoading = computed<any>(() => indexStore.isLoading);
const user = computed<any>(() => {
  const id = props.id || (route.params.id as string);
  return indexStore.allIndexs?.find((item: any) => item.id === parseInt(id as string)) || null;
});

const fetchUser = () => {
  indexStore.fetchUser(parseInt(props.id));
};
watch(() => props.id, () => fetchUser(), { immediate: true });
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
    const result = await fixStoreMemberMismatchRule.apply("src/views/UserDetail.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      projectRoot: testProjectRoot
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("useUserStore");
    expect(result.content).toContain("userStore.fetchUser");
    expect(result.content).not.toContain("indexStore.fetchUser");
    expect(result.content).not.toContain("indexStore.allIndexs");
    expect(result.content).toMatch(/userStore\.(allUsers|currentUser)/);
  });

  it("should fix wrong store usage for any entity (ProductDetail, allProducts)", async () => {
    mockGetStoreMethodMap.mockResolvedValue({
      fetchProduct: "product",
      allProducts: "product",
      currentProduct: "product",
      isLoading: "index",
    });

    const content = `<script setup lang="ts">
import { computed } from "vue";
import { useIndexStore } from "@/store/index";

const indexStore = useIndexStore();
const props = defineProps({ id: String });

const product = computed(() => {
  return indexStore.allProducts?.find((item: any) => item.id === props.id) || null;
});
const fetchProduct = () => indexStore.fetchProduct(props.id);
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
    const result = await fixStoreMemberMismatchRule.apply("src/views/ProductDetail.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      projectRoot: testProjectRoot
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("productStore.fetchProduct");
    expect(result.content).not.toContain("indexStore.fetchProduct");
    expect(result.content).toMatch(/productStore\.(allProducts|currentProduct)/);
  });
});
