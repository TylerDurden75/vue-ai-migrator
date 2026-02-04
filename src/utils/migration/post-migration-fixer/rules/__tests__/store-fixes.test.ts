/**
 * Tests for store-related rules
 */

import {
  asyncFunctionRule,
  storeIndexRemoveObsoleteImportsRule,
  storeDefineStoreClosingRule,
  storeVuexGettersDispatchRule,
  duplicateKeysRule,
  piniaStoreCrossStoreDepsRule
} from "../store-fixes";
import type { FixContext } from "../../types";

jest.mock("../../utils/store-analysis-cache");

describe("asyncFunctionRule", () => {
  it("should make function async if it uses await", async () => {
    const content = `export const useUserStore = defineStore('user', {
  state: () => ({
    users: []
  }),
  actions: {
    fetchUsers() {
      const data = await api.getUsers();
      return data;
    }
  }
});`;

    const result = await asyncFunctionRule.apply("src/store/modules/user.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("async fetchUsers()");
    expect(result.fixes.some(fix => fix.includes("fetchUsers"))).toBe(true);
  });

  it("should make arrow function async if it uses await", async () => {
    const content = `export const useUserStore = defineStore('user', {
  state: () => ({
    users: []
  }),
  actions: {
    fetchUsers: () => {
      const data = await api.getUsers();
      return data;
    }
  }
});`;

    const result = await asyncFunctionRule.apply("src/store/modules/user.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("async");
    expect(result.fixes.length).toBeGreaterThan(0);
  });

  it("should not modify function that is already async", async () => {
    const content = `export const useUserStore = defineStore('user', {
  actions: {
    async fetchUsers() {
      const data = await api.getUsers();
      return data;
    }
  }
});`;

    const result = await asyncFunctionRule.apply("src/store/modules/user.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    // Should not add duplicate async
    const asyncMatches = result.content.match(/async\s+async/g);
    expect(asyncMatches).toBeNull();
  });

  it("should remove multiple async keywords if present", async () => {
    const content = `async async function test() {
  const data = await api.getData();
  return data;
}`;

    const result = await asyncFunctionRule.apply("test.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    // The rule should clean up multiple async keywords
    expect(result.fixed).toBe(true);
    expect(result.content).not.toContain("async async");
  });

  it("should make function with params and : void return type async (Pinia store style)", async () => {
    const content = `  function fetchUser(userId: number): void {
    SET_LOADING(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      const user = { id: userId, name: "User " + userId };
      SET_CURRENT_USER(user);
    } finally {
      SET_LOADING(false);
    }
  }`;

    const result = await asyncFunctionRule.apply("src/store/modules/user.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("async function fetchUser(userId: number)");
    expect(result.content).toContain("): Promise<void> {");
    expect(result.content).toContain("await new Promise");
  });

  it("should make function with : void return type async", async () => {
    const content = `function fetchCurrentUser(): void {
  await userStore.fetchCurrentUser();
}`;

    const result = await asyncFunctionRule.apply("src/store/index.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("async function fetchCurrentUser");
    expect(result.content).toContain("): Promise<void> {");
    expect(result.content).not.toContain("): void {");
  });

  it("should not apply when no await is present", async () => {
    const content = `export const useUserStore = defineStore('user', {
  actions: {
    fetchUsers() {
      return api.getUsers();
    }
  }
});`;

    const result = await asyncFunctionRule.apply("src/store/modules/user.ts", content, {
      enableTypeScript: false,
      isVueFile: false
    });

    expect(result.fixed).toBe(false);
  });

  it("should handle multiple functions with await", async () => {
    const content = `export const useUserStore = defineStore('user', {
  actions: {
    fetchUsers() {
      const data = await api.getUsers();
      return data;
    },
    updateUser() {
      const data = await api.updateUser();
      return data;
    }
  }
});`;

    const result = await asyncFunctionRule.apply("src/store/modules/user.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("async fetchUsers()");
    expect(result.content).toContain("async updateUser()");
    expect(result.fixes.length).toBeGreaterThanOrEqual(2);
  });
});

describe("storeDefineStoreClosingRule", () => {
  const emptyContext = { enableTypeScript: true, isVueFile: false } as FixContext;

  it("should fix }; }; }); at end of store to } });", async () => {
    const content = `export const useAppStore = defineStore('app', () => {
  const theme = ref('light');
  return {
    theme
  };

};
});
`;
    const result = await storeDefineStoreClosingRule.apply("src/store/modules/app.ts", content, emptyContext);
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("  }\n});");
    expect(result.content).not.toMatch(/\}\s*;\s*\n+\s*\}\s*;\s*\n+\s*\}\s*\)\s*;\s*$/m);
  });

  it("should fix even when content has trailing newline after });", async () => {
    const content = `export const useAppStore = defineStore('app', () => {
  return { theme: ref('light') }
};

};
});
`;
    const result = await storeDefineStoreClosingRule.apply("src/store/modules/app.ts", content, emptyContext);
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("  }\n});");
    expect(result.content.trimEnd()).toMatch(/\}\s*\)\s*;\s*$/);
  });

  it("should not apply when closing is already correct", async () => {
    const content = `export const useAppStore = defineStore('app', () => {
  return { theme: ref('light') }
});
`;
    const result = await storeDefineStoreClosingRule.apply("src/store/modules/app.ts", content, emptyContext);
    expect(result.fixed).toBe(false);
  });
});

describe("storeIndexRemoveObsoleteImportsRule", () => {
  const emptyContext = { enableTypeScript: false, isVueFile: false } as FixContext;

  it("should remove default imports from ./modules/* in store/index", async () => {
    const content = `import { defineStore } from "pinia";
import { ref, computed } from "vue";
import userModule from "./modules/user";
import productModule from "./modules/product";
import appModule from "./modules/app";
import { useUserStore } from "@/store/modules/user";

export const useIndexStore = defineStore("index", () => {
  const userStore = useUserStore();
  return { userStore };
});
export default useIndexStore;
`;
    const result = await storeIndexRemoveObsoleteImportsRule.apply("src/store/index.js", content, emptyContext);
    expect(result.fixed).toBe(true);
    expect(result.content).not.toContain("import userModule from");
    expect(result.content).not.toContain("import productModule from");
    expect(result.content).not.toContain("import appModule from");
    expect(result.content).toContain("import { useUserStore } from");
    expect(result.content).toContain("defineStore");
  });

  it("should remove unused Vue import from store/index", async () => {
    const content = `import Vue from "vue";
import { defineStore } from "pinia";
import { useUserStore } from "@/store/modules/user";
export const useIndexStore = defineStore("index", () => {
  const userStore = useUserStore();
  return { userStore };
});
`;
    const result = await storeIndexRemoveObsoleteImportsRule.apply("src/store/index.js", content, emptyContext);
    expect(result.fixed).toBe(true);
    expect(result.content).not.toContain('import Vue from "vue"');
  });

  it("should not apply when store/index has no obsolete imports", async () => {
    const content = `import { defineStore } from "pinia";
import { useUserStore } from "@/store/modules/user";
export const useIndexStore = defineStore("index", () => ({ userStore: useUserStore() }));
`;
    const result = await storeIndexRemoveObsoleteImportsRule.apply("src/store/index.js", content, emptyContext);
    expect(result.fixed).toBe(false);
  });
});

describe("storeVuexGettersDispatchRule", () => {
  it("should convert getters['user/xxx'] and dispatch('user/xxx') and add useUserStore", async () => {
    const content = `import { defineStore } from "pinia";
import { ref, computed } from "vue";

export default defineStore("index", () => {
  const loading = ref(false);
  const isAuthenticated = computed(() => (getters["user/isAuthenticated"]));
  const currentUser = computed(() => (getters["user/currentUser"]));
  async function fetchCurrentUser() {
    await dispatch("user/fetchCurrentUser");
  }
  return { loading, isAuthenticated, currentUser, fetchCurrentUser };
});`;

    const result = await storeVuexGettersDispatchRule.apply("src/store/index.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("userStore.isAuthenticated");
    expect(result.content).toContain("userStore.currentUser");
    expect(result.content).toContain("userStore.fetchCurrentUser()");
    expect(result.content).toContain("import { useUserStore } from '@/store/modules/user'");
    expect(result.content).toContain("const userStore = useUserStore();");
    expect(result.content).not.toContain('getters["user/');
    expect(result.content).not.toContain('dispatch("user/');
  });
});

describe("duplicateKeysRule", () => {
  it("should remove duplicate keys in store return object", async () => {
    const content = `export const useUserStore = defineStore('user', () => {
  const currentUser = ref(null);
  const currentUserComputed = computed(() => currentUser.value);
  
  return {
    currentUser: currentUser,
    currentUser: currentUserComputed
  };
});`;

    const result = await duplicateKeysRule.apply("src/store/modules/user.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(true);
    // Should keep the ref (source of truth in Pinia)
    expect(result.content).toContain("currentUser: currentUser");
    // Should not have the computed duplicate
    expect(result.content).not.toContain("currentUser: currentUserComputed");
    expect(result.fixes.some(fix => fix.includes("duplicate"))).toBe(true);
  });

  it("should handle duplicate keys on same line (one key-value per line only)", async () => {
    const content = `export const useUserStore = defineStore('user', () => {
  const users = ref([]);
  const usersComputed = computed(() => users.value);
  
  return {
    users: users,
    users: usersComputed
  };
});`;

    const result = await duplicateKeysRule.apply("src/store/modules/user.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("users: users");
    expect(result.content).not.toContain("users: usersComputed");
  });

  it("should prefer ref version when duplicate exists", async () => {
    const content = `export const useUserStore = defineStore('user', () => {
  const items = ref([]);
  const itemsComputed = computed(() => items.value);
  
  return {
    items: items,
    items: itemsComputed
  };
});`;

    const result = await duplicateKeysRule.apply("src/store/modules/user.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("items: items");
    expect(result.content).not.toContain("items: itemsComputed");
  });

  it("should not modify when no duplicate keys exist", async () => {
    const content = `export const useUserStore = defineStore('user', () => {
  const users = ref([]);
  const currentUser = ref(null);
  
  return {
    users: users,
    currentUser: currentUser
  };
});`;

    const result = await duplicateKeysRule.apply("src/store/modules/user.ts", content, {
      enableTypeScript: false,
      isVueFile: false
    });

    expect(result.fixed).toBe(false);
  });

  it("should not apply when no return statement exists", async () => {
    const content = `export const useUserStore = defineStore('user', {
  state: () => ({
    users: []
  })
});`;

    const result = await duplicateKeysRule.apply("src/store/modules/user.ts", content, {
      enableTypeScript: false,
      isVueFile: false
    });

    expect(result.fixed).toBe(false);
  });

  it("should handle multiple duplicate keys", async () => {
    const content = `export const useUserStore = defineStore('user', () => {
  const users = ref([]);
  const usersComputed = computed(() => users.value);
  const currentUser = ref(null);
  const currentUserComputed = computed(() => currentUser.value);
  
  return {
    users: users,
    users: usersComputed,
    currentUser: currentUser,
    currentUser: currentUserComputed
  };
});`;

    const result = await duplicateKeysRule.apply("src/store/modules/user.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("users: users");
    expect(result.content).toContain("currentUser: currentUser");
    expect(result.content).not.toContain("users: usersComputed");
    expect(result.content).not.toContain("currentUser: currentUserComputed");
  });
});

describe("piniaStoreCrossStoreDepsRule", () => {
  it("should add useUserStore import and const userStore when store references userStore without defining it", async () => {
    const content = `import { defineStore } from "pinia";
import { ref, computed } from "vue";

export const useIndexStore = defineStore("index", () => {
  const loading = ref(false);
  const isLoading = computed(() => loading.value);
  const isAuthenticated = computed(() => userStore.isAuthenticated);
  const currentUser = computed(() => userStore.currentUser);

  async function fetchCurrentUser() {
    await userStore.fetchCurrentUser();
  }

  return { loading, isLoading, isAuthenticated, currentUser, fetchCurrentUser };
});
`;

    const result = await piniaStoreCrossStoreDepsRule.apply("src/store/index.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("import { useUserStore } from '@/store/modules/user'");
    expect(result.content).toContain("const userStore = useUserStore();");
    expect(result.content).toMatch(/defineStore\s*\(\s*["']index["'].*?\{\s*\n\s*const userStore = useUserStore\(\)/s);
  });

  it("should not add store ref when already defined", async () => {
    const content = `import { defineStore } from "pinia";
import { useUserStore } from '@/store/modules/user';
import { ref, computed } from "vue";

export const useIndexStore = defineStore("index", () => {
  const userStore = useUserStore();
  const loading = ref(false);
  const currentUser = computed(() => userStore.currentUser);
  return { loading, currentUser };
});
`;

    const result = await piniaStoreCrossStoreDepsRule.apply("src/store/index.ts", content, {
      enableTypeScript: true,
      isVueFile: false
    });

    expect(result.fixed).toBe(false);
    expect(result.content).toBe(content);
  });

  it("should not apply to .vue files", () => {
    const content = "const userStore = useUserStore(); userStore.foo();";
    expect(piniaStoreCrossStoreDepsRule.shouldApply("src/views/Home.vue", content)).toBe(false);
  });
});
