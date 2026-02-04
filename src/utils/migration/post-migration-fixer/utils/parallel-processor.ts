/**
 * Parallel file processor for post-migration fixes
 * Processes multiple files concurrently with configurable concurrency limit
 */

import type { FixResult } from "../types";

export interface ProcessFileOptions {
  filePath: string;
  content: string;
  enableTypeScript: boolean;
  projectRoot?: string;
  fixFunction: (
    filePath: string,
    content: string,
    enableTypeScript: boolean,
    projectRoot?: string
  ) => Promise<FixResult>;
}

/**
 * Process files in parallel batches with concurrency limit
 * @param files Array of file processing options
 * @param concurrency Maximum number of files to process concurrently (default: 5)
 * @returns Array of results in the same order as input files
 */
export async function processFilesInParallel(
  files: ProcessFileOptions[],
  concurrency: number = 5
): Promise<Array<{ filePath: string; result: FixResult }>> {
  const results: Array<{ filePath: string; result: FixResult }> = [];
  
  // Process files in batches
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    
    // Process batch in parallel
    const batchResults = await Promise.all(
      batch.map(async ({ filePath, content, enableTypeScript, projectRoot, fixFunction }) => {
        try {
          const result = await fixFunction(filePath, content, enableTypeScript, projectRoot);
          return { filePath, result };
        } catch (error) {
          // Return error result instead of throwing
          return {
            filePath,
            result: {
              fixed: false,
              content,
              fixes: [],
              issues: [
                `Error processing file: ${error instanceof Error ? error.message : String(error)}`
              ]
            }
          };
        }
      })
    );
    
    results.push(...batchResults);
  }
  
  return results;
}

/**
 * Get optimal concurrency based on system resources
 * Uses CPU count if available, otherwise defaults to 5
 */
import os from "os";

export function getOptimalConcurrency(): number {
  try {
    // Try to get CPU count from Node.js
    const cpuCount = os.cpus().length;
    // Use CPU count - 1 to leave one core free, minimum 2, maximum 10
    return Math.max(2, Math.min(cpuCount - 1, 10));
  } catch {
    // Fallback to default if os module not available
    return 5;
  }
}
