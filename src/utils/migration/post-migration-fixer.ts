/**
 * Post-migration fixer - delegates to optimized rule engine
 * This file ensures the migration pipeline uses the modular rule-based fixer
 * (post-migration-fixer/index.ts) instead of the legacy implementation.
 */

export {
  fixPostMigrationIssues,
  fixImportPaths,
  clearStoreAnalysisCache,
} from "./post-migration-fixer/index";
export type { FixResult } from "./post-migration-fixer/types";
