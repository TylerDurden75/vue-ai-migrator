/**
 * Tests for store-related import fixes
 * Tests correctWrongStoreImportsRule and addMissingStoreImportsRule
 */

import { correctWrongStoreImportsRule, addMissingStoreImportsRule } from "../rules/import-fixes";
import * as storeAnalyzer from "../utils/store-analyzer";
import { clearStoreAnalysisCache } from "../utils/store-analysis-cache";

// Mock the store analyzer
jest.mock("../utils/store-analyzer");

describe("correctWrongStoreImportsRule", () => {
  const mockProjectRoot = "/test/project";

  beforeEach(() => {
    jest.clearAllMocks();
    clearStoreAnalysisCache();
  });

  it("should detect and correct wrong store import", async () => {
    // Mock store analysis: userStore has methods getUser, setUser
    const mockStoreMap = new Map<string, string>([
      ["getUser", "user"],
      ["setUser", "user"],
      ["getProduct", "product"],
      ["setProduct", "product"]
    ]);

    (storeAnalyzer.analyzePiniaStores as jest.Mock).mockResolvedValue(mockStoreMap);

    const content = `<script setup lang="ts">
import { useUserStore } from '@/store/modules/product';
const userStore = useUserStore();
const user = userStore.getUser();
</script>`;

    const result = await correctWrongStoreImportsRule.apply(
      "test.vue",
      content,
      {
        enableTypeScript: true,
        projectRoot: mockProjectRoot,
        isVueFile: true,
        scriptContent: content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || ""
      }
    );

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("import { useUserStore } from '@/store/modules/user'");
    expect(result.content).not.toContain("import { useUserStore } from '@/store/modules/product'");
    expect(result.fixes.length).toBeGreaterThan(0);
  });

  it("should not fix if store name matches module name", async () => {
    const mockStoreMap = new Map<string, string>([
      ["getUser", "user"],
      ["setUser", "user"]
    ]);

    (storeAnalyzer.analyzePiniaStores as jest.Mock).mockResolvedValue(mockStoreMap);

    const content = `<script setup lang="ts">
import { useUserStore } from '@/store/modules/user';
const userStore = useUserStore();
const user = userStore.getUser();
</script>`;

    const result = await correctWrongStoreImportsRule.apply(
      "test.vue",
      content,
      {
        enableTypeScript: true,
        projectRoot: mockProjectRoot,
        isVueFile: true,
        scriptContent: content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || ""
      }
    );

    expect(result.fixed).toBe(false);
  });

  it("should replace store variable references when correcting import", async () => {
    const mockStoreMap = new Map<string, string>([
      ["getUser", "user"],
      ["setUser", "user"]
    ]);

    (storeAnalyzer.analyzePiniaStores as jest.Mock).mockResolvedValue(mockStoreMap);

    const content = `<script setup lang="ts">
import { useUserStore } from '@/store/modules/product';
const productStore = useUserStore();
const user = productStore.getUser();
</script>`;

    const result = await correctWrongStoreImportsRule.apply(
      "test.vue",
      content,
      {
        enableTypeScript: true,
        projectRoot: mockProjectRoot,
        isVueFile: true,
        scriptContent: content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || ""
      }
    );

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("const userStore = useUserStore()");
    expect(result.content).toContain("userStore.getUser()");
    expect(result.content).not.toContain("productStore");
  });

  it("should not apply if no projectRoot provided", async () => {
    const content = `<script setup lang="ts">
import { useUserStore } from '@/store/modules/product';
</script>`;

    const result = await correctWrongStoreImportsRule.apply(
      "test.vue",
      content,
      {
        enableTypeScript: true,
        isVueFile: true,
        scriptContent: content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || ""
      }
    );

    expect(result.fixed).toBe(false);
  });

  it("should not apply if not a Vue file with script setup", async () => {
    const content = `import { useUserStore } from '@/store/modules/product';`;

    const result = await correctWrongStoreImportsRule.apply(
      "test.ts",
      content,
      {
        enableTypeScript: true,
        projectRoot: mockProjectRoot,
        isVueFile: false,
        scriptContent: content
      }
    );

    expect(result.fixed).toBe(false);
  });
});

describe("addMissingStoreImportsRule", () => {
  const mockProjectRoot = "/test/project";

  beforeEach(() => {
    jest.clearAllMocks();
    clearStoreAnalysisCache();
  });

  it("should add missing store import when store is used", async () => {
    const mockStoreMap = new Map<string, string>([
      ["getUser", "user"],
      ["setUser", "user"],
      ["allUsers", "user"]
    ]);

    (storeAnalyzer.analyzePiniaStores as jest.Mock).mockResolvedValue(mockStoreMap);

    const content = `<script setup lang="ts">
const userStore = useUserStore();
const users = userStore.allUsers;
</script>`;

    const result = await addMissingStoreImportsRule.apply(
      "test.vue",
      content,
      {
        enableTypeScript: true,
        projectRoot: mockProjectRoot,
        isVueFile: true,
        scriptContent: content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || ""
      }
    );

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("import { useUserStore } from '@/store/modules/user'");
    expect(result.fixes.some(f => f.includes("Added missing store imports"))).toBe(true);
  });

  it("should add store initialization if missing", async () => {
    const mockStoreMap = new Map<string, string>([
      ["getUser", "user"],
      ["allUsers", "user"]
    ]);

    (storeAnalyzer.analyzePiniaStores as jest.Mock).mockResolvedValue(mockStoreMap);

    const content = `<script setup lang="ts">
import { useUserStore } from '@/store/modules/user';
const users = userStore.allUsers;
</script>`;

    const result = await addMissingStoreImportsRule.apply(
      "test.vue",
      content,
      {
        enableTypeScript: true,
        projectRoot: mockProjectRoot,
        isVueFile: true,
        scriptContent: content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || ""
      }
    );

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("const userStore = useUserStore()");
  });

  it("should add import and initialization for direct method calls", async () => {
    const mockStoreMap = new Map<string, string>([
      ["getUser", "user"],
      ["fetchUsers", "user"]
    ]);

    (storeAnalyzer.analyzePiniaStores as jest.Mock).mockResolvedValue(mockStoreMap);

    const content = `<script setup lang="ts">
const user = getUser();
</script>`;

    const result = await addMissingStoreImportsRule.apply(
      "test.vue",
      content,
      {
        enableTypeScript: true,
        projectRoot: mockProjectRoot,
        isVueFile: true,
        scriptContent: content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || ""
      }
    );

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("import { useUserStore } from '@/store/modules/user'");
    expect(result.content).toContain("const userStore = useUserStore()");
    expect(result.content).toContain("userStore.getUser()");
  });

  it("should not add import if store is already imported", async () => {
    const mockStoreMap = new Map<string, string>([
      ["getUser", "user"],
      ["allUsers", "user"]
    ]);

    (storeAnalyzer.analyzePiniaStores as jest.Mock).mockResolvedValue(mockStoreMap);

    const content = `<script setup lang="ts">
import { useUserStore } from '@/store/modules/user';
const userStore = useUserStore();
const users = userStore.allUsers;
</script>`;

    const result = await addMissingStoreImportsRule.apply(
      "test.vue",
      content,
      {
        enableTypeScript: true,
        projectRoot: mockProjectRoot,
        isVueFile: true,
        scriptContent: content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || ""
      }
    );

    // Should not add duplicate import, but might add initialization if missing
    const importMatches = result.content.match(/import.*useUserStore.*from/g);
    expect(importMatches?.length).toBe(1);
  });

  it("should not add import for Vue APIs", async () => {
    const mockStoreMap = new Map<string, string>([
      ["computed", "vue"], // This shouldn't happen, but test the filter
    ]);

    (storeAnalyzer.analyzePiniaStores as jest.Mock).mockResolvedValue(mockStoreMap);

    const content = `<script setup lang="ts">
const count = computed(() => 0);
</script>`;

    const result = await addMissingStoreImportsRule.apply(
      "test.vue",
      content,
      {
        enableTypeScript: true,
        projectRoot: mockProjectRoot,
        isVueFile: true,
        scriptContent: content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || ""
      }
    );

    // Should not add store import for Vue APIs
    expect(result.content).not.toContain("import { useVueStore }");
  });

  it("should not add import for locally defined functions", async () => {
    const mockStoreMap = new Map<string, string>([
      ["getUser", "user"]
    ]);

    (storeAnalyzer.analyzePiniaStores as jest.Mock).mockResolvedValue(mockStoreMap);

    const content = `<script setup lang="ts">
function getUser() {
  return { id: 1 };
}
const user = getUser();
</script>`;

    const result = await addMissingStoreImportsRule.apply(
      "test.vue",
      content,
      {
        enableTypeScript: true,
        projectRoot: mockProjectRoot,
        isVueFile: true,
        scriptContent: content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || ""
      }
    );

    // Should not add store import if function is defined locally
    expect(result.content).not.toContain("import { useUserStore }");
  });

  it("should not apply if no projectRoot provided", async () => {
    const content = `<script setup lang="ts">
const users = userStore.allUsers;
</script>`;

    const result = await addMissingStoreImportsRule.apply(
      "test.vue",
      content,
      {
        enableTypeScript: true,
        isVueFile: true,
        scriptContent: content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || ""
      }
    );

    expect(result.fixed).toBe(false);
  });

  it("should not apply if not a Vue file with script setup", async () => {
    const content = `const users = userStore.allUsers;`;

    const result = await addMissingStoreImportsRule.apply(
      "test.ts",
      content,
      {
        enableTypeScript: true,
        projectRoot: mockProjectRoot,
        isVueFile: false,
        scriptContent: content
      }
    );

    expect(result.fixed).toBe(false);
  });

  it("should handle multiple missing stores", async () => {
    const mockStoreMap = new Map<string, string>([
      ["getUser", "user"],
      ["allUsers", "user"],
      ["getProduct", "product"],
      ["allProducts", "product"]
    ]);

    (storeAnalyzer.analyzePiniaStores as jest.Mock).mockResolvedValue(mockStoreMap);

    const content = `<script setup lang="ts">
const users = userStore.allUsers;
const products = productStore.allProducts;
</script>`;

    const result = await addMissingStoreImportsRule.apply(
      "test.vue",
      content,
      {
        enableTypeScript: true,
        projectRoot: mockProjectRoot,
        isVueFile: true,
        scriptContent: content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || ""
      }
    );

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("import { useUserStore }");
    expect(result.content).toContain("import { useProductStore }");
    expect(result.content).toContain("const userStore = useUserStore()");
    expect(result.content).toContain("const productStore = useProductStore()");
  });
});
