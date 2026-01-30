export {
  migratePackageJson,
  type PackageMigrationResult,
} from "./package-migrator";
export {
  migrateWebpackConfig,
  type WebpackConfigMigrationResult,
} from "./webpack-config-migrator";
export { validateMigration } from "./post-migration-validator";
export {
  fixPostMigrationIssues,
  fixImportPaths,
  type FixResult,
} from "./post-migration-fixer";
