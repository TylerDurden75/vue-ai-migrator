/**
 * Performance benchmarks for post-migration fixer
 * Compares old multi-pass system vs new optimized single-pass system
 */

import * as fs from "fs/promises";
import * as path from "path";
import { performance } from "perf_hooks";

// Import both systems
import { fixPostMigrationIssues as fixPostMigrationIssuesOptimized } from "../src/utils/migration/post-migration-fixer/index";
import { fixPostMigrationIssues as fixPostMigrationIssuesLegacy } from "../src/utils/migration/post-migration-fixer";

interface BenchmarkResult {
  system: "legacy" | "optimized";
  fileCount: number;
  totalTime: number;
  averageTimePerFile: number;
  memoryUsage: NodeJS.MemoryUsage;
  fixesApplied: number;
}

/**
 * Run benchmark on a set of files
 */
async function benchmarkSystem(
  system: "legacy" | "optimized",
  files: Array<{ path: string; content: string }>,
  enableTypeScript: boolean = false,
  projectRoot?: string
): Promise<BenchmarkResult> {
  const startMemory = process.memoryUsage();
  const startTime = performance.now();

  let fixesApplied = 0;

  if (system === "optimized") {
    // Use optimized system (single pass)
    for (const file of files) {
      const result = await fixPostMigrationIssuesOptimized(
        file.path,
        file.content,
        enableTypeScript,
        projectRoot
      );
      if (result.fixed) {
        fixesApplied += result.fixes.length;
      }
    }
  } else {
    // Use legacy system (multi-pass) - import from the old post-migration-fixer.ts
    for (const file of files) {
      const result = await fixPostMigrationIssuesLegacy(
        file.path,
        file.content,
        enableTypeScript,
        projectRoot
      );
      if (result.fixed) {
        fixesApplied += result.fixes.length;
      }
    }
  }

  const endTime = performance.now();
  const endMemory = process.memoryUsage();

  return {
    system,
    fileCount: files.length,
    totalTime: endTime - startTime,
    averageTimePerFile: (endTime - startTime) / files.length,
    memoryUsage: {
      rss: endMemory.rss - startMemory.rss,
      heapTotal: endMemory.heapTotal - startMemory.heapTotal,
      heapUsed: endMemory.heapUsed - startMemory.heapUsed,
      external: endMemory.external - startMemory.external,
      arrayBuffers: endMemory.arrayBuffers - startMemory.arrayBuffers
    },
    fixesApplied
  };
}

/**
 * Generate test files for benchmarking
 */
function generateTestFiles(count: number): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];

  for (let i = 0; i < count; i++) {
    files.push({
      path: `test-project/src/components/Component${i}.vue`,
      content: `
<template>
  <div>
    <h1>{{ title | capitalize }}</h1>
    <p>{{ description }}</p>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useUserStore } from '@/store/modules/user'

const title = ref('Component ${i}')
const description = ref('Description ${i}')

const userStore = useUserStore()
const currentUser = computed(() => userStore.currentUser)

export default {
  data() {
    return {
      title: 'Component ${i}'
    }
  }
}
</script>
      `.trim()
    });
  }

  return files;
}

/**
 * Run full benchmark suite
 */
export async function runBenchmarks(): Promise<void> {
  console.log("🚀 Starting Performance Benchmarks...\n");

  const testSizes = [10, 50, 100];
  const results: Array<{
    fileCount: number;
    legacy: BenchmarkResult;
    optimized: BenchmarkResult;
    improvement: {
      timeReduction: number;
      memoryReduction: number;
    };
  }> = [];

  for (const fileCount of testSizes) {
    console.log(`📊 Benchmarking with ${fileCount} files...`);
    
    const testFiles = generateTestFiles(fileCount);
    const projectRoot = path.join(__dirname, "../test-project");

    // Warm up
    await benchmarkSystem("optimized", testFiles.slice(0, 2), false, projectRoot);

    // Benchmark legacy system
    const legacyResult = await benchmarkSystem("legacy", testFiles, false, projectRoot);
    
    // Small delay between runs
    await new Promise(resolve => setTimeout(resolve, 100));

    // Benchmark optimized system
    const optimizedResult = await benchmarkSystem("optimized", testFiles, false, projectRoot);

    const timeReduction = ((legacyResult.totalTime - optimizedResult.totalTime) / legacyResult.totalTime) * 100;
    const memoryReduction = ((legacyResult.memoryUsage.heapUsed - optimizedResult.memoryUsage.heapUsed) / legacyResult.memoryUsage.heapUsed) * 100;

    results.push({
      fileCount,
      legacy: legacyResult,
      optimized: optimizedResult,
      improvement: {
        timeReduction,
        memoryReduction
      }
    });

    console.log(`  ✅ Legacy: ${legacyResult.totalTime.toFixed(2)}ms (${legacyResult.averageTimePerFile.toFixed(2)}ms/file)`);
    console.log(`  ✅ Optimized: ${optimizedResult.totalTime.toFixed(2)}ms (${optimizedResult.averageTimePerFile.toFixed(2)}ms/file)`);
    console.log(`  📈 Time reduction: ${timeReduction.toFixed(1)}%`);
    console.log(`  📈 Memory reduction: ${memoryReduction.toFixed(1)}%\n`);
  }

  // Print summary
  console.log("📊 Benchmark Summary:");
  console.log("=".repeat(60));
  results.forEach(({ fileCount, legacy, optimized, improvement }) => {
    console.log(`\nFiles: ${fileCount}`);
    console.log(`  Legacy:     ${legacy.totalTime.toFixed(2)}ms (${legacy.averageTimePerFile.toFixed(2)}ms/file)`);
    console.log(`  Optimized:  ${optimized.totalTime.toFixed(2)}ms (${optimized.averageTimePerFile.toFixed(2)}ms/file)`);
    console.log(`  ⚡ Time improvement: ${improvement.timeReduction.toFixed(1)}%`);
    console.log(`  💾 Memory improvement: ${improvement.memoryReduction.toFixed(1)}%`);
  });
}

// Run if executed directly
if (require.main === module) {
  runBenchmarks().catch(console.error);
}
