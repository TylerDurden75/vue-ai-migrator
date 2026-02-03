/**
 * Performance benchmarks for the post-migration fixer (single-pass rule engine)
 */

import * as path from "path";
import { performance } from "perf_hooks";
import { fixPostMigrationIssues } from "../src/utils/migration/post-migration-fixer/index";

interface BenchmarkResult {
  fileCount: number;
  totalTime: number;
  averageTimePerFile: number;
  memoryUsage: NodeJS.MemoryUsage;
  fixesApplied: number;
}

function generateTestFiles(count: number): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];

  for (let i = 0; i < count; i++) {
    files.push({
      path: `test-project/src/components/Component${i}.vue`,
      content: `
<template>
  <div>
    <h1>{{ title }}</h1>
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
</script>
      `.trim()
    });
  }

  return files;
}

async function runBenchmark(
  files: Array<{ path: string; content: string }>,
  enableTypeScript: boolean,
  projectRoot?: string
): Promise<BenchmarkResult> {
  const startMemory = process.memoryUsage();
  const startTime = performance.now();
  let fixesApplied = 0;

  for (const file of files) {
    const result = await fixPostMigrationIssues(
      file.path,
      file.content,
      enableTypeScript,
      projectRoot
    );
    if (result.fixed) {
      fixesApplied += result.fixes.length;
    }
  }

  const endTime = performance.now();
  const endMemory = process.memoryUsage();

  return {
    fileCount: files.length,
    totalTime: endTime - startTime,
    averageTimePerFile: (endTime - startTime) / files.length,
    memoryUsage: endMemory,
    fixesApplied
  };
}

export async function runBenchmarks(): Promise<void> {
  console.log("🚀 Post-Migration Fixer Performance Benchmarks\n");

  const testSizes = [10, 50, 100];
  const projectRoot = path.join(__dirname, "../test-project");
  const results: BenchmarkResult[] = [];

  for (const fileCount of testSizes) {
    console.log(`📊 Benchmarking ${fileCount} files...`);

    const testFiles = generateTestFiles(fileCount);
    await runBenchmark(testFiles.slice(0, 2), false, projectRoot); // warm up

    const result = await runBenchmark(testFiles, false, projectRoot);
    results.push(result);

    console.log(`  ✅ Total: ${result.totalTime.toFixed(2)}ms (${result.averageTimePerFile.toFixed(2)}ms/file)`);
    console.log(`  💾 Heap: ${(result.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB\n`);
  }

  console.log("📊 Summary:");
  console.log("=".repeat(60));
  results.forEach((r) => {
    console.log(`  ${r.fileCount} files: ${r.totalTime.toFixed(2)}ms (${r.averageTimePerFile.toFixed(2)}ms/file)`);
  });
}

if (require.main === module) {
  runBenchmarks().catch(console.error);
}
