export {
  migratePackageJson,
  type PackageMigrationResult,
} from "./package-migrator";
export {
  migrateWebpackConfig,
  type WebpackConfigMigrationResult,
} from "./webpack-config-migrator";
export {
  migrateToViteConfig,
  type ViteConfigMigrationResult,
} from "./vite-config-migrator";
export { validateMigration } from "./post-migration-validator";
export {
  fixPostMigrationIssues,
  fixImportPaths,
  type FixResult,
} from "./post-migration-fixer";
export {
  checkDependencyConflicts,
  cleanupDependencies,
  verifyDependencyConsistency,
  installDependencies,
  type DependencyCheckResult,
  type CleanupResult,
} from "./dependency-checker";
export {
  createOrUpdateTsConfig,
  deleteTsConfig,
  type TypeScriptConfigResult,
} from "./typescript-config";
