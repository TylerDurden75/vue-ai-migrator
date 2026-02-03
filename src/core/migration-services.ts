/**
 * Migration services: injectable dependencies for the migrator.
 * Allows tests to inject mocks and future extensions (custom fixer, cache, etc.).
 */

import type { CodemodRunner } from "../codemods/runner";
import type { IAIService } from "../interfaces";
import type { FixResult } from "../utils/migration/post-migration-fixer/types";

export type PostMigrationFixFn = (
  filePath: string,
  content: string,
  enableTypeScript: boolean,
  projectRoot?: string
) => Promise<FixResult>;

/** Rollback manager type (concrete: has saveBackups in addition to IRollbackManager methods) */
export type RollbackManagerLike = {
  backupFile(filePath: string): Promise<void>;
  restoreFile(filePath: string): Promise<boolean>;
  restoreAll(): Promise<{ restored: number; failed: string[] }>;
  loadBackups(): Promise<void>;
  hasBackup(filePath: string): boolean;
  getBackupCount(): number;
  saveBackups(): Promise<void>;
};

/** Cache manager type (needsProcessing, markProcessed, loadCache, saveCache) */
export type CacheManagerLike = {
  needsProcessing(filePath: string, content: string, transformations: string[]): boolean;
  markProcessed(filePath: string, content: string, transformations: string[]): void;
  loadCache(): Promise<void>;
  saveCache(): Promise<void>;
};

export interface MigrationServices {
  codemodRunner: CodemodRunner;
  aiService: IAIService | null;
  cacheManager: CacheManagerLike | null;
  rollbackManager: RollbackManagerLike | null;
  fixPostMigration: PostMigrationFixFn;
}

export interface CreateMigrationServicesOptions {
  projectPath: string;
  aiApiKey?: string;
  aiProvider?: "openai" | "mistral" | "claude" | "anthropic";
  useAI?: boolean;
  useCache?: boolean;
  enableRollback?: boolean;
  useOptimizedFixer?: boolean;
  enableTypeScript?: boolean;
}

/**
 * Creates default migration services (runner, AI, cache, rollback, fixer).
 * Used by the migrator when no custom services are injected.
 */
export async function createDefaultMigrationServices(
  options: CreateMigrationServicesOptions
): Promise<MigrationServices> {
  const { CodemodRunner } = await import("../codemods/runner");
  const { createAIService } = await import("../ai/unified-service");
  const { CacheManager } = await import("../utils/cache");
  const { RollbackManager } = await import("../utils/safety");
  const useOptimized = options.useOptimizedFixer !== false;

  const codemodRunner = new CodemodRunner();
  const aiService: IAIService | null =
    options.useAI && options.aiApiKey
      ? createAIService(options.aiApiKey, options.aiProvider ?? "openai")
      : null;
  const cacheManager = options.useCache
    ? new CacheManager(options.projectPath)
    : null;
  const rollbackManager = options.enableRollback
    ? new RollbackManager(options.projectPath)
    : null;

  // Per-file fixer: always use optimized (includes import paths). Legacy is only for the optional second batch pass.
  const { fixPostMigrationIssues } = await import(
    "../utils/migration/post-migration-fixer/index"
  );

  return {
    codemodRunner,
    aiService,
    cacheManager,
    rollbackManager,
    fixPostMigration: fixPostMigrationIssues,
  };
}
