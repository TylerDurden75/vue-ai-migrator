/**
 * Tests for regex cache
 */

import { getCachedRegex, regexCache } from "../regex-cache";

describe("regex-cache", () => {
  beforeEach(() => {
    regexCache.clear();
  });

  describe("getCachedRegex", () => {
    it("should return same regex for same pattern (cache hit)", () => {
      const regex1 = getCachedRegex("\\d+");
      const regex2 = getCachedRegex("\\d+");

      expect(regex1).toBe(regex2);
      expect(regex1.test("123")).toBe(true);
    });

    it("should create new regex for cache miss", () => {
      const regex1 = getCachedRegex("\\d+");
      const regex2 = getCachedRegex("\\w+");

      expect(regex1).not.toBe(regex2);
      expect(regex1.source).toBe("\\d+");
      expect(regex2.source).toBe("\\w+");
    });

    it("should handle flags parameter", () => {
      const regexGi = getCachedRegex("test", "gi");
      const regexG = getCachedRegex("test", "g");

      expect(regexGi.flags).toContain("i");
      expect(regexG.flags).not.toContain("i");
    });

    it("should treat pattern without flags and with empty flags as same key", () => {
      const regex1 = getCachedRegex("\\d+");
      const regex2 = getCachedRegex("\\d+", "");

      expect(regex1).toBe(regex2);
    });
  });

  describe("regexCache", () => {
    it("should clear cache", () => {
      getCachedRegex("\\d+");
      expect(regexCache.size()).toBe(1);

      regexCache.clear();
      expect(regexCache.size()).toBe(0);

      const regex = getCachedRegex("\\d+");
      expect(regex.test("1")).toBe(true);
    });
  });
});
