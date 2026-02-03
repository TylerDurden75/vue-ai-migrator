/**
 * Post-migration fixer - entry point for the rule engine.
 * Re-exports from post-migration-fixer/index.ts for the migration pipeline.
 */

export {
  fixPostMigrationIssues,
  fixImportPaths,
  clearStoreAnalysisCache,
} from "./post-migration-fixer/index";
export type { FixResult } from "./post-migration-fixer/types";
