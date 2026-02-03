/**
 * Benchmark utilities for measuring performance improvements
 */

export interface BenchmarkResult {
  name: string;
  duration: number; // milliseconds
  filesProcessed: number;
  fixesApplied: number;
  memoryUsed?: number; // MB
}

/**
 * Measure execution time of a function
 */
export async function benchmark<T>(
  name: string,
  fn: () => Promise<T>
): Promise<{ result: T; benchmark: BenchmarkResult }> {
  const startTime = process.hrtime.bigint();
  const startMemory = process.memoryUsage().heapUsed;

  const result = await fn();

  const endTime = process.hrtime.bigint();
  const endMemory = process.memoryUsage().heapUsed;

  const duration = Number(endTime - startTime) / 1_000_000; // Convert to milliseconds
  const memoryUsed = (endMemory - startMemory) / 1024 / 1024; // Convert to MB

  return {
    result,
    benchmark: {
      name,
      duration,
      filesProcessed: 0, // Should be set by caller
      fixesApplied: 0, // Should be set by caller
      memoryUsed,
    },
  };
}

/**
 * Compare multiple benchmark results
 */
export function compareBenchmarks(
  benchmarks: BenchmarkResult[]
): string {
  let report = `# Performance Benchmark Comparison\n\n`;
  
  benchmarks.forEach(benchmark => {
    report += `## ${benchmark.name}\n`;
    report += `- Duration: ${benchmark.duration.toFixed(2)}ms\n`;
    report += `- Files processed: ${benchmark.filesProcessed}\n`;
    report += `- Fixes applied: ${benchmark.fixesApplied}\n`;
    if (benchmark.memoryUsed) {
      report += `- Memory used: ${benchmark.memoryUsed.toFixed(2)}MB\n`;
    }
    report += `- Average time per file: ${(benchmark.duration / benchmark.filesProcessed).toFixed(2)}ms\n`;
    report += `\n`;
  });

  // Calculate improvements if we have old and new benchmarks
  if (benchmarks.length >= 2) {
    const oldBenchmark = benchmarks[0];
    const newBenchmark = benchmarks[1];
    
    const timeImprovement = ((oldBenchmark.duration - newBenchmark.duration) / oldBenchmark.duration) * 100;
    const memoryImprovement = oldBenchmark.memoryUsed && newBenchmark.memoryUsed
      ? ((oldBenchmark.memoryUsed - newBenchmark.memoryUsed) / oldBenchmark.memoryUsed) * 100
      : 0;

    report += `## Improvements\n`;
    report += `- Time improvement: ${timeImprovement.toFixed(2)}%\n`;
    if (memoryImprovement !== 0) {
      report += `- Memory improvement: ${memoryImprovement.toFixed(2)}%\n`;
    }
    report += `\n`;
  }

  return report;
}
