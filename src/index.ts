export { migrate, MigrationOptions, MigrationResult } from './core/migrator';
export {
  createDefaultMigrationServices,
  type MigrationServices,
  type PostMigrationFixFn,
} from './core/migration-services';
export {
  processOneFile,
  type ProcessOneFileParams,
  type ProcessOneFileResult,
  type ProcessOneFileOptions,
} from './core/migration-pipeline';
export { CodemodRunner } from './codemods/runner';
export { MigrationAgent, AgentConfig, AgentResponse } from './ai/agent';
export { UnifiedAIService, createAIService, UnifiedAIServiceConfig } from './ai/unified-service';
export type { LLMProvider } from './ai/unified-service';
export { MigrationClassifier, ClassificationResult, ComplexityLevel } from './core/classifier';
export { MigrationReporter, MigrationReport, FileReport } from './core/reporter';
export { detectVueVersion, analyzeProject } from './utils/analysis';
export { MigrationError } from './utils/safety';
export {
  parseVueFile,
  reconstructVueFile,
  isVueFile,
  VueFileParts,
  transformVueFileParts,
} from './utils/codegen';
export { RollbackManager } from './utils/safety';
export { CacheManager } from './utils/cache';
export { migratePackageJson } from './utils/migration';
export { validateMigration } from './utils/migration';
export { transformTemplate } from './codemods/transforms/template';
export { generateDiff, formatDiffForConsole, getDiffSummary, DiffResult } from './utils/codegen';
export { TestGenerator, GeneratedTest } from './utils/codegen';
