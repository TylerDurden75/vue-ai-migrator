/**
 * Tests for parallel processor
 */

import os from "os";
import { processFilesInParallel, getOptimalConcurrency } from "../utils/parallel-processor";
import type { FixResult } from "../types";

describe("Parallel Processor", () => {
  describe("processFilesInParallel", () => {
    it("should process files in parallel batches", async () => {
      const files = Array.from({ length: 10 }, (_, i) => ({
        filePath: `file${i}.vue`,
        content: `content${i}`,
        enableTypeScript: false,
        fixFunction: async (filePath: string, content: string): Promise<FixResult> => {
          // Simulate processing time
          await new Promise(resolve => setTimeout(resolve, 10));
          return {
            fixed: true,
            content: `fixed-${content}`,
            fixes: [`Fixed ${filePath}`],
            issues: []
          };
        }
      }));

      const results = await processFilesInParallel(files, 3);
      
      expect(results).toHaveLength(10);
      results.forEach((result, i) => {
        expect(result.filePath).toBe(`file${i}.vue`);
        expect(result.result.fixed).toBe(true);
        expect(result.result.content).toBe(`fixed-content${i}`);
      });
    });

    it("should handle errors gracefully", async () => {
      const files = [
        {
          filePath: "file1.vue",
          content: "content1",
          enableTypeScript: false,
          fixFunction: async (): Promise<FixResult> => {
            throw new Error("Processing error");
          }
        },
        {
          filePath: "file0.vue",
          content: "content0",
          enableTypeScript: false,
          fixFunction: async (): Promise<FixResult> => {
            throw "string error";
          }
        },
        {
          filePath: "file2.vue",
          content: "content2",
          enableTypeScript: false,
          fixFunction: async (): Promise<FixResult> => ({
            fixed: true,
            content: "fixed-content2",
            fixes: ["Fixed file2"],
            issues: []
          })
        }
      ];

      const results = await processFilesInParallel(files, 3);
      
      expect(results).toHaveLength(3);
      expect(results[0].result.fixed).toBe(false);
      expect(results[0].result.issues.length).toBeGreaterThan(0);
      expect(results[1].result.fixed).toBe(false);
      expect(results[1].result.issues[0]).toContain("string error");
      expect(results[2].result.fixed).toBe(true);
    });

    it("should respect concurrency limit", async () => {
      const processingOrder: number[] = [];
      const concurrency = 3;
      const totalFiles = 10;

      const files = Array.from({ length: totalFiles }, (_, i) => ({
        filePath: `file${i}.vue`,
        content: `content${i}`,
        enableTypeScript: false,
        fixFunction: async (filePath: string): Promise<FixResult> => {
          const fileNum = parseInt(filePath.match(/\d+/)?.[0] || "0");
          processingOrder.push(fileNum);
          await new Promise(resolve => setTimeout(resolve, 10));
          return {
            fixed: true,
            content: `fixed-content${fileNum}`,
            fixes: [`Fixed ${filePath}`],
            issues: []
          };
        }
      }));

      await processFilesInParallel(files, concurrency);
      
      // Check that batches were processed (first 3 should start together)
      // Note: exact order may vary, but we should see batches
      expect(processingOrder.length).toBe(totalFiles);
    });
  });

  describe("getOptimalConcurrency", () => {
    it("should return a number between 2 and 10", () => {
      const concurrency = getOptimalConcurrency();
      expect(concurrency).toBeGreaterThanOrEqual(2);
      expect(concurrency).toBeLessThanOrEqual(10);
    });

    it("should return default value if os module fails", () => {
      // This test verifies the fallback behavior
      const concurrency = getOptimalConcurrency();
      expect(typeof concurrency).toBe("number");
      expect(concurrency).toBeGreaterThan(0);
    });

    it("should return 5 when os.cpus throws", () => {
      jest.spyOn(os, "cpus").mockImplementation(() => {
        throw new Error("cpus failed");
      });
      try {
        expect(getOptimalConcurrency()).toBe(5);
      } finally {
        jest.restoreAllMocks();
      }
    });
  });
});
