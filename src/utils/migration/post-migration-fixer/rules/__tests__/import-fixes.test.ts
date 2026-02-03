/**
 * Tests for import-related rules
 */

import {
  splitImportsOnSameLineRule,
  removeVuexImportsRule,
  removeVueCompilerMacrosRule,
  mergeDuplicateImportsRule,
  duplicateSameIdentifierImportsRule,
  correctWrongStoreImportsRule,
  addMissingStoreImportsRule
} from "../import-fixes";
import type { FixContext } from "../../types";
import * as fs from "fs/promises";
import * as path from "path";

// Mock store-analysis-cache
jest.mock("../../utils/store-analysis-cache", () => ({
  getStoreMethodMap: jest.fn()
}));

import { getStoreMethodMap } from "../../utils/store-analysis-cache";

const mockGetStoreMethodMap = getStoreMethodMap as jest.MockedFunction<typeof getStoreMethodMap>;

describe("splitImportsOnSameLineRule", () => {
  it("should split two imports on same line (single quote)", async () => {
    const content = "import { useUserStore } from '@/store/modules/user';import { useIndexStore } from '@/store/index';";
    const result = await splitImportsOnSameLineRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("';\nimport ");
    expect(result.content).not.toContain("';import"); // no same-line import without newline
  });

  it("should split two imports on same line (double quote)", async () => {
    const content = 'import { ref } from "vue";import { computed } from "vue";';
    const result = await splitImportsOnSameLineRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain('";\nimport ');
  });

  it("should not modify when imports are already on separate lines", async () => {
    const content = "import { a } from 'x';\nimport { b } from 'y';";
    const result = await splitImportsOnSameLineRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });
    expect(result.fixed).toBe(false);
  });
});

describe("removeVueCompilerMacrosRule", () => {
  it("should remove defineProps and defineEmits from vue imports", async () => {
    const content = `import { computed, defineProps, defineEmits } from 'vue';\nconst props = defineProps({});`;
    const result = await removeVueCompilerMacrosRule.apply("Component.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("import { computed } from 'vue'");
    expect(result.content).not.toMatch(/import\s*\{[^}]*\bdefineProps\b/);
    expect(result.content).not.toMatch(/import\s*\{[^}]*\bdefineEmits\b/);
  });

  it("should not modify when vue import has no compiler macros", async () => {
    const content = `import { ref, computed } from 'vue';`;
    const result = await removeVueCompilerMacrosRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true
    });
    expect(result.fixed).toBe(false);
  });
});

describe("removeVuexImportsRule", () => {
  it("should remove Vuex imports", async () => {
    const content = 'import { mapGetters } from "vuex";\nconst test = 1;';
    const result = await removeVuexImportsRule.apply("test.js", content, {
      enableTypeScript: false,
      isVueFile: false
    });

    expect(result.fixed).toBe(true);
    expect(result.content).not.toContain("vuex");
    expect(result.content).toContain("const test = 1;");
    expect(result.fixes).toContain("Removed Vuex imports");
  });

  it("should remove Vuex from destructured imports", async () => {
    const content = 'import { mapGetters, other } from "vuex";';
    const result = await removeVuexImportsRule.apply("test.js", content, {
      enableTypeScript: false,
      isVueFile: false
    });

    expect(result.fixed).toBe(true);
    expect(result.content).not.toContain("mapGetters");
  });

  it("should not modify content without Vuex imports", async () => {
    const content = 'import { ref } from "vue";\nconst test = 1;';
    const result = await removeVuexImportsRule.apply("test.js", content, {
      enableTypeScript: false,
      isVueFile: false
    });

    expect(result.fixed).toBe(false);
    expect(result.content).toBe(content);
  });
});

describe("mergeDuplicateImportsRule", () => {
  it("should merge duplicate imports from same module", async () => {
    const content = `<script setup>
import { ref } from 'vue';
import { computed } from 'vue';
const test = ref(1);
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await mergeDuplicateImportsRule.apply("test.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
      scriptContent
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toMatch(/import\s+\{\s*ref\s*,\s*computed\s*\}\s+from\s+['"]vue['"]/);
    expect(result.fixes).toContain("Merged duplicate imports from same modules");
  });

  it("should not modify content without duplicate imports", async () => {
    const content = `<script setup>
import { ref } from 'vue';
import { computed } from '@vue/composition-api';
const test = ref(1);
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await mergeDuplicateImportsRule.apply("test.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
      scriptContent
    });

    // Should not fix if imports are from different modules
    expect(result.fixed).toBe(false);
  });

  it("should not apply to non-Vue files", async () => {
    const content = "import { ref } from 'vue';";
    const result = await mergeDuplicateImportsRule.apply("test.js", content, {
      enableTypeScript: false,
      isVueFile: false
    });

    expect(result.fixed).toBe(false);
  });
});

describe("duplicateSameIdentifierImportsRule", () => {
  it("should remove duplicate import of same identifier from different path (prefer @/store/index)", async () => {
    const content = `<script setup lang="ts">
import { useIndexStore } from "@/store/modules/index";
import { useIndexStore } from "@/store/index";
import { useRouter } from "vue-router";
const indexStore = useIndexStore();
</script>`;
    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const result = await duplicateSameIdentifierImportsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain('import { useIndexStore } from "@/store/index"');
    expect(result.content).not.toContain('@/store/modules/index');
    expect(result.fixes.some(f => f.includes("duplicate import"))).toBe(true);
  });

  it("should remove duplicate const declaration (consecutive)", async () => {
    const content = `<script setup lang="ts">
import { useIndexStore } from "@/store/index";
const indexStore = useIndexStore();
const indexStore = useIndexStore();
</script>`;
    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const result = await duplicateSameIdentifierImportsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent
    });
    expect(result.fixed).toBe(true);
    const script = result.content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const count = (script.match(/const\s+indexStore\s*=/g) || []).length;
    expect(count).toBe(1);
    expect(result.fixes.some(f => f.includes("duplicate const"))).toBe(true);
  });

  it("should remove duplicate const declaration (non-consecutive)", async () => {
    const content = `<script setup lang="ts">
import { useIndexStore } from "@/store/index";
const indexStore = useIndexStore();
const props = defineProps({ id: String });
const indexStore = useIndexStore();
</script>`;
    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const result = await duplicateSameIdentifierImportsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent
    });
    expect(result.fixed).toBe(true);
    const script = result.content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";
    const count = (script.match(/const\s+indexStore\s*=/g) || []).length;
    expect(count).toBe(1);
  });
});

describe("correctWrongStoreImportsRule", () => {
  const mockProjectRoot = "/test/project";

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock store analysis cache
    mockGetStoreMethodMap.mockResolvedValue({
      getUsers: "user",
      allUsers: "user",
      getProducts: "product",
      allProducts: "product"
    });
  });

  it("should correct wrong store import when methods suggest different store", async () => {
    const content = `<script setup lang="ts">
import { useProductStore } from '@/store/modules/user';
const productStore = useProductStore();
const users = productStore.getUsers();
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await correctWrongStoreImportsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      projectRoot: mockProjectRoot
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("import { useUserStore } from '@/store/modules/user'");
    expect(result.content).toContain("const userStore = useUserStore()");
    expect(result.content).toContain("userStore.getUsers()");
    expect(mockGetStoreMethodMap).toHaveBeenCalledWith(mockProjectRoot);
  });

  it("should not modify when store import is correct", async () => {
    const content = `<script setup lang="ts">
import { useUserStore } from '@/store/modules/user';
const userStore = useUserStore();
const users = userStore.getUsers();
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await correctWrongStoreImportsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      projectRoot: mockProjectRoot
    });

    expect(result.fixed).toBe(false);
  });

  it("should not apply without project root", async () => {
    const content = `<script setup>
import { useUserStore } from '@/store/modules/user';
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await correctWrongStoreImportsRule.apply("test.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
      scriptContent
    });

    expect(result.fixed).toBe(false);
    expect(mockGetStoreMethodMap).not.toHaveBeenCalled();
  });

  it("should not apply when store analysis fails", async () => {
    mockGetStoreMethodMap.mockResolvedValue({});

    const content = `<script setup>
import { useUserStore } from '@/store/modules/user';
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await correctWrongStoreImportsRule.apply("test.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
      scriptContent,
      projectRoot: mockProjectRoot
    });

    expect(result.fixed).toBe(false);
  });

  it("should correct based on property access", async () => {
    const content = `<script setup lang="ts">
import { useProductStore } from '@/store/modules/user';
const productStore = useProductStore();
const users = productStore.allUsers;
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await correctWrongStoreImportsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      projectRoot: mockProjectRoot
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("import { useUserStore } from '@/store/modules/user'");
    expect(result.content).toContain("userStore.allUsers");
  });

  it("should handle multiple wrong imports", async () => {
    const content = `<script setup lang="ts">
import { useProductStore } from '@/store/modules/user';
import { useUserStore } from '@/store/modules/product';
const productStore = useProductStore();
const userStore = useUserStore();
const users = productStore.getUsers();
const products = userStore.getProducts();
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await correctWrongStoreImportsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      projectRoot: mockProjectRoot
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("import { useUserStore } from '@/store/modules/user'");
    expect(result.content).toContain("import { useProductStore } from '@/store/modules/product'");
  });
});

describe("addMissingStoreImportsRule", () => {
  const mockProjectRoot = "/test/project";

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock store analysis cache
    mockGetStoreMethodMap.mockResolvedValue({
      getUsers: "user",
      allUsers: "user",
      fetchUsers: "user",
      getProducts: "product",
      allProducts: "product"
    });
  });

  it("should add missing store import when store is used", async () => {
    const content = `<script setup lang="ts">
const userStore = useUserStore();
const users = userStore.getUsers();
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await addMissingStoreImportsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      projectRoot: mockProjectRoot
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("import { useUserStore } from '@/store/modules/user'");
    expect(result.content).toContain("const userStore = useUserStore()");
    expect(result.fixes.some(f => f.includes("Added missing store imports"))).toBe(true);
  });

  it("should add store initialization if missing", async () => {
    const content = `<script setup lang="ts">
import { useUserStore } from '@/store/modules/user';
const users = userStore.getUsers();
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await addMissingStoreImportsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      projectRoot: mockProjectRoot
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("const userStore = useUserStore()");
  });

  it("should detect direct method calls and add store", async () => {
    const content = `<script setup lang="ts">
const users = fetchUsers();
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await addMissingStoreImportsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      projectRoot: mockProjectRoot
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("import { useUserStore } from '@/store/modules/user'");
    expect(result.content).toContain("const userStore = useUserStore()");
  });

  it("should not add duplicate imports", async () => {
    const content = `<script setup lang="ts">
import { useUserStore } from '@/store/modules/user';
const userStore = useUserStore();
const users = userStore.getUsers();
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await addMissingStoreImportsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      projectRoot: mockProjectRoot
    });

    // Should not add duplicate import
    const importMatches = result.content.match(/import\s+.*useUserStore.*from/g);
    expect(importMatches?.length).toBe(1);
  });

  it("should not add store for Vue API methods", async () => {
    const content = `<script setup lang="ts">
const count = ref(0);
const doubled = computed(() => count.value * 2);
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await addMissingStoreImportsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      projectRoot: mockProjectRoot
    });

    expect(result.fixed).toBe(false);
    expect(result.content).not.toContain("useComputedStore");
    expect(result.content).not.toContain("useRefStore");
  });

  it("should not apply without project root", async () => {
    const content = `<script setup>
const userStore = useUserStore();
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await addMissingStoreImportsRule.apply("test.vue", content, {
      enableTypeScript: false,
      isVueFile: true,
      scriptContent
    });

    expect(result.fixed).toBe(false);
    expect(mockGetStoreMethodMap).not.toHaveBeenCalled();
  });

  it("should handle multiple missing stores", async () => {
    const content = `<script setup lang="ts">
const userStore = useUserStore();
const productStore = useProductStore();
const users = userStore.getUsers();
const products = productStore.getProducts();
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await addMissingStoreImportsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      projectRoot: mockProjectRoot
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("import { useUserStore } from '@/store/modules/user'");
    expect(result.content).toContain("import { useProductStore } from '@/store/modules/product'");
  });

  it("should not add store for locally defined functions", async () => {
    const content = `<script setup lang="ts">
function fetchUsers() {
  return [];
}
const users = fetchUsers();
</script>`;

    const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || "";

    const result = await addMissingStoreImportsRule.apply("test.vue", content, {
      enableTypeScript: true,
      isVueFile: true,
      scriptContent,
      projectRoot: mockProjectRoot
    });

    expect(result.fixed).toBe(false);
    expect(result.content).not.toContain("useUserStore");
  });
});
