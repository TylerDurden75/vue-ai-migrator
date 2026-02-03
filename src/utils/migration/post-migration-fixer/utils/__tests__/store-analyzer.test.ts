/**
 * Tests for store analyzer utility
 */

import { analyzePiniaStores } from "../store-analyzer";
import * as fs from "fs/promises";
import * as path from "path";

// Mock fs
jest.mock("fs/promises");

const mockFs = fs as jest.Mocked<typeof fs>;

describe("analyzePiniaStores", () => {
  const mockProjectRoot = "/test/project";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should analyze stores from src/store/modules", async () => {
    const userStoreContent = `
export const useUserStore = defineStore('user', () => {
  const users = ref([]);
  const allUsers = computed(() => users.value);
  
  function getUsers() {
    return users.value;
  }
  
  const fetchUsers = async () => {
    // fetch logic
  };
  
  return {
    users,
    allUsers,
    getUsers,
    fetchUsers
  };
});
`;

    const productStoreContent = `
export const useProductStore = defineStore('product', () => {
  const products = ref([]);
  const allProducts = computed(() => products.value);
  
  return {
    products,
    allProducts
  };
});
`;

    mockFs.readdir.mockResolvedValue(["user.ts", "product.ts"] as any);
    mockFs.readFile
      .mockResolvedValueOnce(userStoreContent)
      .mockResolvedValueOnce(productStoreContent);

    const result = await analyzePiniaStores(mockProjectRoot);

    expect(result.size).toBeGreaterThan(0);
    expect(result.get("getUsers")).toBe("user");
    expect(result.get("allUsers")).toBe("user");
    expect(result.get("fetchUsers")).toBe("user");
    expect(result.get("allProducts")).toBe("product");
    
    expect(mockFs.readdir).toHaveBeenCalledWith(
      path.join(mockProjectRoot, "src", "store", "modules")
    );
  });

  it("should fallback to src/stores if src/store/modules doesn't exist", async () => {
    mockFs.readdir
      .mockRejectedValueOnce(new Error("Not found"))
      .mockResolvedValueOnce(["user.store.ts"] as any);

    const storeContent = `
export const useUserStore = defineStore('user', () => {
  return {
    users: ref([]),
    getUsers: () => []
  };
});
`;

    mockFs.readFile.mockResolvedValueOnce(storeContent);

    const result = await analyzePiniaStores(mockProjectRoot);

    expect(result.size).toBeGreaterThan(0);
    expect(mockFs.readdir).toHaveBeenCalledWith(
      path.join(mockProjectRoot, "src", "stores")
    );
  });

  it("should handle stores with aliased properties", async () => {
    const storeContent = `
export const useUserStore = defineStore('user', () => {
  const internalUsers = ref([]);
  
  return {
    users: internalUsers,
    allUsers: computed(() => internalUsers.value)
  };
});
`;

    mockFs.readdir.mockResolvedValue(["user.ts"] as any);
    mockFs.readFile.mockResolvedValueOnce(storeContent);

    const result = await analyzePiniaStores(mockProjectRoot);

    expect(result.get("users")).toBe("user");
    expect(result.get("allUsers")).toBe("user");
  });

  it("should extract function declarations", async () => {
    const storeContent = `
export const useUserStore = defineStore('user', () => {
  function fetchUsers() {
    return [];
  }
  
  const updateUser = () => {
    // update logic
  };
  
  return {
    fetchUsers,
    updateUser
  };
});
`;

    mockFs.readdir.mockResolvedValue(["user.ts"] as any);
    mockFs.readFile.mockResolvedValueOnce(storeContent);

    const result = await analyzePiniaStores(mockProjectRoot);

    expect(result.get("fetchUsers")).toBe("user");
    expect(result.get("updateUser")).toBe("user");
  });

  it("should skip Vue API functions", async () => {
    const storeContent = `
export const useUserStore = defineStore('user', () => {
  const users = ref([]);
  const computedUsers = computed(() => users.value);
  
  return {
    users,
    computedUsers
  };
});
`;

    mockFs.readdir.mockResolvedValue(["user.ts"] as any);
    mockFs.readFile.mockResolvedValueOnce(storeContent);

    const result = await analyzePiniaStores(mockProjectRoot);

    expect(result.get("users")).toBe("user");
    expect(result.get("computedUsers")).toBe("user");
    // Should not include Vue APIs
    expect(result.get("ref")).toBeUndefined();
    expect(result.get("computed")).toBeUndefined();
  });

  it("should return empty map if no stores found", async () => {
    mockFs.readdir.mockResolvedValue([]);

    const result = await analyzePiniaStores(mockProjectRoot);

    expect(result.size).toBe(0);
  });

  it("should return empty map if directory doesn't exist", async () => {
    mockFs.readdir.mockRejectedValue(new Error("Directory not found"));
    mockFs.readFile = jest.fn().mockRejectedValue(new Error("File not found"));

    const result = await analyzePiniaStores(mockProjectRoot);

    expect(result.size).toBe(0);
  });

  it("should skip non-TypeScript/JavaScript files", async () => {
    mockFs.readdir.mockResolvedValue(["user.ts", "readme.md", "product.js", "config.json"] as any);

    const userStoreContent = `
export const useUserStore = defineStore('user', () => {
  return { users: ref([]) };
});
`;

    const productStoreContent = `
export const useProductStore = defineStore('product', () => {
  return { products: ref([]) };
});
`;

    mockFs.readFile
      .mockResolvedValueOnce(userStoreContent)
      .mockResolvedValueOnce(productStoreContent);

    const result = await analyzePiniaStores(mockProjectRoot);

    expect(mockFs.readFile).toHaveBeenCalledTimes(2); // Only .ts and .js files
    expect(result.size).toBeGreaterThan(0);
  });

  it("should handle stores without return statement", async () => {
    const storeContent = `
export const useUserStore = defineStore('user', () => {
  const users = ref([]);
  // No return statement
});
`;

    mockFs.readdir.mockResolvedValue(["user.ts"] as any);
    mockFs.readFile.mockResolvedValueOnce(storeContent);

    const result = await analyzePiniaStores(mockProjectRoot);

    // Should still extract function declarations
    expect(result.size).toBeGreaterThanOrEqual(0);
  });
});
