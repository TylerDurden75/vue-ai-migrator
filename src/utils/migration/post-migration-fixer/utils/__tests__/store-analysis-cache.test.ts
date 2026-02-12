/**
 * Tests for store analysis cache
 */

import {
  getStoreAnalysis,
  getStoreMethodMap,
  getStoreConfigForModule,
  clearStoreAnalysisCache,
  hasStoreAnalysisCache,
} from "../store-analysis-cache";
import { analyzePiniaStores } from "../store-analyzer";

jest.mock("../store-analyzer");

const mockAnalyzePiniaStores = analyzePiniaStores as jest.MockedFunction<
  typeof analyzePiniaStores
>;

describe("store-analysis-cache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearStoreAnalysisCache();
  });

  describe("getStoreAnalysis", () => {
    it("should return null when analyzePiniaStores throws", async () => {
      mockAnalyzePiniaStores.mockRejectedValue(new Error("Analysis failed"));

      const result = await getStoreAnalysis("/project/root");

      expect(result).toBeNull();
      expect(hasStoreAnalysisCache("/project/root")).toBe(false);
    });

    it("should use cache when same project is requested twice", async () => {
      const mockMap = new Map([["fetchUser", "user"]]);
      mockAnalyzePiniaStores.mockResolvedValue(mockMap);

      const result1 = await getStoreAnalysis("/project/root");
      const result2 = await getStoreAnalysis("/project/root");

      expect(result1).toBe(mockMap);
      expect(result2).toBe(mockMap);
      expect(mockAnalyzePiniaStores).toHaveBeenCalledTimes(1);
    });

    it("should re-analyze when project root changes", async () => {
      const mockMap1 = new Map([["fetchUser", "user"]]);
      const mockMap2 = new Map([["fetchProduct", "product"]]);
      mockAnalyzePiniaStores
        .mockResolvedValueOnce(mockMap1)
        .mockResolvedValueOnce(mockMap2);

      const result1 = await getStoreAnalysis("/project1");
      const result2 = await getStoreAnalysis("/project2");

      expect(result1).toBe(mockMap1);
      expect(result2).toBe(mockMap2);
      expect(mockAnalyzePiniaStores).toHaveBeenCalledTimes(2);
    });
  });

  describe("getStoreMethodMap", () => {
    it("should return empty object when analysis is null", async () => {
      mockAnalyzePiniaStores.mockResolvedValue(null as any);

      const result = await getStoreMethodMap("/project/root");

      expect(result).toEqual({});
    });

    it("should return empty object when analysis is empty map", async () => {
      mockAnalyzePiniaStores.mockResolvedValue(new Map());

      const result = await getStoreMethodMap("/project/root");

      expect(result).toEqual({});
    });

    it("should convert Map to Record", async () => {
      const mockMap = new Map([
        ["fetchUser", "user"],
        ["fetchProduct", "product"],
      ]);
      mockAnalyzePiniaStores.mockResolvedValue(mockMap);

      const result = await getStoreMethodMap("/project/root");

      expect(result).toEqual({
        fetchUser: "user",
        fetchProduct: "product",
      });
    });
  });

  describe("getStoreConfigForModule", () => {
    it("should use mainStoreInfo when module is index", () => {
      const mainStoreInfo = {
        storeName: "useMainStore",
        storeVar: "mainStore",
        importPath: "@/store",
        storeId: "main",
      };
      const result = getStoreConfigForModule("index", mainStoreInfo);
      expect(result).toEqual({
        storeVar: "mainStore",
        storeName: "useMainStore",
        importPath: "@/store",
      });
    });

    it("should fallback to indexStore when module is index and no mainStoreInfo", () => {
      const result = getStoreConfigForModule("index");
      expect(result).toEqual({
        storeVar: "indexStore",
        storeName: "useIndexStore",
        importPath: "@/store/index",
      });
    });

    it("should derive from module name for other modules", () => {
      const result = getStoreConfigForModule("user");
      expect(result).toEqual({
        storeVar: "userStore",
        storeName: "useUserStore",
        importPath: "@/store/modules/user",
      });
    });
  });

  describe("hasStoreAnalysisCache", () => {
    it("should return false when cache is empty", () => {
      expect(hasStoreAnalysisCache("/project/root")).toBe(false);
    });

    it("should return true when cache exists for same project", async () => {
      mockAnalyzePiniaStores.mockResolvedValue(new Map([["x", "y"]]));
      await getStoreAnalysis("/project/root");

      expect(hasStoreAnalysisCache("/project/root")).toBe(true);
    });

    it("should return false when cache exists for different project", async () => {
      mockAnalyzePiniaStores.mockResolvedValue(new Map([["x", "y"]]));
      await getStoreAnalysis("/project/root");

      expect(hasStoreAnalysisCache("/other/project")).toBe(false);
    });
  });
});
