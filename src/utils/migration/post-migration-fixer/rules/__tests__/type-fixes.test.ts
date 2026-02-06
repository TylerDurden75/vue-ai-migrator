/**
 * Tests for TypeScript type-related rules
 */

import {
  incorrectEventTypeRule,
  filtersKeyAccessRule,
  stripTypeScriptAnnotationsRule,
  typescriptTypeImprovementsRule
} from "../type-fixes";

describe("incorrectEventTypeRule", () => {
  it("should fix incorrect Event type in function parameters", async () => {
    const content = `export const useUserStore = defineStore('user', {
  actions: {
    SET_USERS(event: Event) {
      // Set users
    }
  }
});`;

    const result = await incorrectEventTypeRule.apply("src/store/modules/user.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("SET_USERS(value: any)");
    expect(result.content).not.toContain("event: Event");
    expect(result.fixes.some(fix => fix.includes("SET_USERS"))).toBe(true);
  });

  it("should fix incorrect Event type in arrow function", async () => {
    const content = `const setFilter = (event: Event) => {
  // Set filter
};`;

    const result = await incorrectEventTypeRule.apply("src/store/modules/filter.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(true);
    // setFilter gets { key: string; value: any } per rule (filter functions)
    expect(result.content).toContain("value:");
    expect(result.content).not.toContain("event: Event");
  });

  it("should use appropriate type for filter functions", async () => {
    const content = `const setFilter = (event: Event) => {
  // Set filter
};`;

    const result = await incorrectEventTypeRule.apply("src/store/modules/filter.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("{ key: string; value: any }");
  });

  it("should handle multiple functions with Event type", async () => {
    const content = `export const useUserStore = defineStore('user', {
  actions: {
    SET_USERS(event: Event) {
      // Set users
    },
    SET_CURRENT_USER(event: Event) {
      // Set current user
    }
  }
});`;

    const result = await incorrectEventTypeRule.apply("src/store/modules/user.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("SET_USERS(value: any)");
    expect(result.content).toContain("SET_CURRENT_USER(value: any)");
    expect(result.fixes.length).toBeGreaterThanOrEqual(2);
  });

  it("should not modify when Event type is not present", async () => {
    const content = `export const useUserStore = defineStore('user', {
  actions: {
    SET_USERS(value: any) {
      // Set users
    }
  }
});`;

    const result = await incorrectEventTypeRule.apply("src/store/modules/user.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(false);
  });

  it("should not apply when Event is not in function parameters", async () => {
    const content = `const handleClick = (e: MouseEvent) => {
  // Handle click
};`;

    const result = await incorrectEventTypeRule.apply("test.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(false);
  });

  it("should not apply to non-store files without Event type", async () => {
    const content = `const test = () => {
  return 1;
};`;

    const result = await incorrectEventTypeRule.apply("test.ts", content, {
      enableTypeScript: false,
      isVueFile: false
    });

    expect(result.fixed).toBe(false);
  });

  it("should use object type for function name containing Filter", async () => {
    const content = `function myFilter(event: Event) {
  return { key: event.target.name, value: event.target.value };
}`;

    const result = await incorrectEventTypeRule.apply("src/utils/filters.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("{ key: string; value: any }");
    expect(result.content).not.toContain("event: Event");
  });
});

describe("filtersKeyAccessRule", () => {
  it("should fix filters[key] access with type assertion", async () => {
    const content = `const applyFilter = (key: string) => {
  const filter = filters[key];
  return filter;
};`;

    const result = await filtersKeyAccessRule.apply("src/store/modules/filter.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("(filters as any)[key]");
    expect(result.content).not.toContain("filters[key]");
    expect(result.fixes.some(fix => fix.includes("filters[key]"))).toBe(true);
  });

  it("should handle multiple filters[key] accesses", async () => {
    const content = `const applyFilters = (key1: string, key2: string) => {
  const filter1 = filters[key1];
  const filter2 = filters[key2];
  return { filter1, filter2 };
};`;

    const result = await filtersKeyAccessRule.apply("src/store/modules/filter.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("(filters as any)[key1]");
    expect(result.content).toContain("(filters as any)[key2]");
    expect(result.fixes.length).toBeGreaterThanOrEqual(2);
  });

  it("should handle filters[key] with whitespace", async () => {
    const content = `const applyFilter = (key: string) => {
  const filter = filters[ key ];
  return filter;
};`;

    const result = await filtersKeyAccessRule.apply("src/store/modules/filter.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("(filters as any)[key]");
  });

  it("should not modify when filters[key] is not present", async () => {
    const content = `const applyFilter = (key: string) => {
  const filter = filters.get(key);
  return filter;
};`;

    const result = await filtersKeyAccessRule.apply("src/store/modules/filter.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(false);
  });

  it("should not apply when no filters[key] access is present", async () => {
    const content = `const test = () => {
  return 1;
};`;

    const result = await filtersKeyAccessRule.apply("test.ts", content, {
      enableTypeScript: false,
      isVueFile: false
    });

    expect(result.fixed).toBe(false);
  });

  it("should handle filters[key] in different contexts", async () => {
    const content = `const getFilter = (key: string) => filters[key];
const setFilter = (key: string, value: any) => {
  filters[key] = value;
};`;

    const result = await filtersKeyAccessRule.apply("src/store/modules/filter.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("(filters as any)[key]");
  });
});

describe("typescriptTypeImprovementsRule", () => {
  it("should not apply when TypeScript is disabled", async () => {
    const content = `const test: any = 1;`;

    const result = await typescriptTypeImprovementsRule.apply("test.ts", content, {
      enableTypeScript: false,
      isVueFile: false
    });

    expect(result.fixed).toBe(false);
  });

  it("should remove computed<any> and ref<any> when TypeScript is enabled", async () => {
    const content = `const items = ref<any>([]);
const filtered = computed<any>(() => items.value.filter(x => x));`;

    const result = await typescriptTypeImprovementsRule.apply("test.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("ref(");
    expect(result.content).toContain("computed(");
    expect(result.content).not.toContain("ref<any>");
    expect(result.content).not.toContain("computed<any>");
  });

  it("should not modify content when TypeScript is enabled but no improvements needed", async () => {
    const content = `const test: any = 1;`;

    const result = await typescriptTypeImprovementsRule.apply("test.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(false);
  });

  it("should apply when TypeScript is enabled and content has computed<any>", async () => {
    const content = `const x = computed<any>(() => 1);`;

    const result = await typescriptTypeImprovementsRule.apply("test.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("computed(() => 1)");
  });

  it("should apply when TypeScript is enabled and content has ref<any>", async () => {
    const content = `const test = ref<any>(null);`;

    const result = await typescriptTypeImprovementsRule.apply("test.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("ref(null)");
  });

  it("should not apply when no type annotations are present", async () => {
    const content = `const test = 1;`;

    const result = await typescriptTypeImprovementsRule.apply("test.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(false);
  });
});

describe("stripTypeScriptAnnotationsRule", () => {
  const jsContext = { enableTypeScript: false, isVueFile: false };

  it("should strip ref<boolean> and function(value: boolean): void in .js when enableTypeScript is false", async () => {
    const content = `const loading = ref<boolean>(false);

  function SET_LOADING(value: boolean): void {
    loading.value = value;
  }`;
    const result = await stripTypeScriptAnnotationsRule.apply("src/store/modules/user.js", content, jsContext);
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("ref(false)");
    expect(result.content).toContain("function SET_LOADING(value) {");
    expect(result.content).not.toContain("ref<boolean>");
    expect(result.content).not.toContain("value: boolean");
    expect(result.content).not.toContain(": void");
  });

  it("should strip set: (v: string) => in .vue script when enableTypeScript is false", async () => {
    const content = `<template><div></div></template>
<script setup>
const currentTheme = computed({
  get: () => appStore.theme,
  set: (v: string) => appStore.setTheme(v),
});
</script>`;
    const result = await stripTypeScriptAnnotationsRule.apply("src/views/Dashboard.vue", content, jsContext);
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("set: (v) =>");
    expect(result.content).not.toContain("(v: string)");
  });

  it("should not modify when enableTypeScript is true", async () => {
    const content = `const loading = ref<boolean>(false);
  function SET_LOADING(value: boolean): void { loading.value = value; }`;
    const result = await stripTypeScriptAnnotationsRule.apply("src/store/user.js", content, {
      enableTypeScript: true,
      isVueFile: false
    });
    expect(result.fixed).toBe(false);
    expect(result.content).toBe(content);
  });

  it("should not apply to .ts files", async () => {
    const content = `function SET_LOADING(value: boolean): void {}`;
    const result = await stripTypeScriptAnnotationsRule.apply("src/store/user.ts", content, jsContext);
    expect(result.fixed).toBe(false);
  });
});
