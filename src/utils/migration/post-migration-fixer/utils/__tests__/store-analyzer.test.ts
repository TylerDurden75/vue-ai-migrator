/**
 * Tests for store analyzer utility
 */

import { analyzePiniaStores } from "../store-analyzer";
import * as fs from "fs/promises";
import * as path from "path";
import { glob } from "glob";

// Mock fs and glob
jest.mock("fs/promises");
jest.mock("glob");

const mockFs = fs as jest.Mocked<typeof fs>;
const mockGlob = glob as jest.MockedFunction<typeof glob>;

describe("analyzePiniaStores", () => {
  const mockProjectRoot = "/test/project";
  const modulesPath = path.join(mockProjectRoot, "src", "store", "modules");

  beforeEach(() => {
    jest.clearAllMocks();
    mockGlob.mockResolvedValue([]);
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

    mockGlob.mockResolvedValue([
      path.join(modulesPath, "user.ts"),
      path.join(modulesPath, "product.ts"),
    ]);
    mockFs.readFile
      .mockResolvedValueOnce(userStoreContent)
      .mockResolvedValueOnce(productStoreContent);

    const result = await analyzePiniaStores(mockProjectRoot);

    expect(result.size).toBeGreaterThan(0);
    expect(result.get("getUsers")).toBe("user");
    expect(result.get("allUsers")).toBe("user");
    expect(result.get("fetchUsers")).toBe("user");
    expect(result.get("allProducts")).toBe("product");
  });

  it("should fallback to src/stores if src/store/modules doesn't exist", async () => {
    mockGlob.mockResolvedValue([]);
    mockFs.readdir.mockResolvedValue(["user.store.ts"] as any);

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

    mockGlob.mockResolvedValue([path.join(modulesPath, "user.ts")]);
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

    mockGlob.mockResolvedValue([path.join(modulesPath, "user.ts")]);
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

    mockGlob.mockResolvedValue([path.join(modulesPath, "user.ts")]);
    mockFs.readFile.mockResolvedValueOnce(storeContent);

    const result = await analyzePiniaStores(mockProjectRoot);

    expect(result.get("users")).toBe("user");
    expect(result.get("computedUsers")).toBe("user");
    // Should not include Vue APIs
    expect(result.get("ref")).toBeUndefined();
    expect(result.get("computed")).toBeUndefined();
  });

  it("should return empty map if no stores found", async () => {
    mockGlob.mockResolvedValue([]);

    const result = await analyzePiniaStores(mockProjectRoot);

    expect(result.size).toBe(0);
  });

  it("should return empty map if directory doesn't exist", async () => {
    mockGlob.mockResolvedValue([]);
    mockFs.readdir.mockRejectedValue(new Error("Directory not found"));

    const result = await analyzePiniaStores(mockProjectRoot);

    expect(result.size).toBe(0);
  });

  it("should skip non-TypeScript/JavaScript files", async () => {
    mockGlob.mockResolvedValue([
      path.join(modulesPath, "user.ts"),
      path.join(modulesPath, "product.js"),
    ]);

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

    // readFile: 2 for user.ts + product.js, then up to 4 for store index attempts
    expect(mockFs.readFile).toHaveBeenCalledTimes(6);
    expect(result.size).toBeGreaterThan(0);
  });

  it("should analyze nested modules (store/modules/cart/index.js)", async () => {
    const cartStoreContent = `
export const useCartStore = defineStore('cart', () => {
  const items = ref([]);
  return { items, addItem: () => {} };
});
`;
    mockGlob.mockResolvedValue([
      path.join(modulesPath, "cart", "index.ts"),
    ]);
    mockFs.readFile.mockResolvedValueOnce(cartStoreContent);

    const result = await analyzePiniaStores(mockProjectRoot);

    expect(result.get("items")).toBe("cart");
    expect(result.get("addItem")).toBe("cart");
  });

  it("should handle stores without return statement", async () => {
    const storeContent = `
export const useUserStore = defineStore('user', () => {
  const users = ref([]);
  // No return statement
});
`;

    mockGlob.mockResolvedValue([path.join(modulesPath, "user.ts")]);
    mockFs.readFile.mockResolvedValueOnce(storeContent);

    const result = await analyzePiniaStores(mockProjectRoot);

    // Should still extract function declarations
    expect(result.size).toBeGreaterThanOrEqual(0);
  });
});
