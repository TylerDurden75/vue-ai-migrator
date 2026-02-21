export {
  migratePackageJson,
  migratePackageJsonForViteSSR,
  addVitestConfigToVite,
  ensureNvmrc,
  ensureEventBus,
  ensureEventBusPlugin,
  injectEventBusPluginInMain,
  type PackageMigrationResult,
} from "./package-migrator";
export {
  mergeVuexStore,
  hasSplitVuexStore,
  type VuexStoreMergeResult,
} from "./vuex-store-merge";
export {
  migrateWebpackConfig,
  type WebpackConfigMigrationResult,
} from "./webpack-config-migrator";
export {
  migrateToViteConfig,
  type ViteConfigMigrationResult,
} from "./vite-config-migrator";
export {
  migrateWebpackToVite,
  type WebpackToViteResult,
} from "./webpack-to-vite-migrator";
export {
  migrateCreateApi,
  addCreateApiViteAlias,
  type CreateApiMigrationResult,
} from "./create-api-migrator";
export {
  migrateSSRToVite,
  type SSRViteMigrationResult,
} from "./ssr-vite-migrator";
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
