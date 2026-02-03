/**
 * Legacy entry point for the multi-pass post-migration fixer.
 * Used for benchmarks/validation (legacy vs optimized) and when useOptimizedFixer is false.
 */
export {
  fixPostMigrationIssues,
  clearStoreAnalysisCache,
  fixImportPaths,
  type FixResult,
} from "./post-migration-fixer-multi-pass";
