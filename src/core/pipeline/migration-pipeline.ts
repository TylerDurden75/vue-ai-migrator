/**
 * Migration Pipeline - Orchestrates the migration process
 * Extracted from migrator.ts to separate concerns
 */

import { FileProcessor } from './file-processor';
import type {
  IRollbackManager,
  ICacheManager,
  PipelineOptions,
  PipelineResult,
} from '../../interfaces';

export class MigrationPipeline {
  constructor(
    private fileProcessor: FileProcessor,
    private rollbackManager: IRollbackManager | null,
    private cacheManager: ICacheManager | null
  ) {}

  /**
   * Execute the migration pipeline
   */
  async execute(options: PipelineOptions): Promise<PipelineResult> {
    const result: PipelineResult = {
      filesProcessed: 0,
      filesModified: 0,
      transformationsApplied: 0,
      errors: [],
      warnings: [],
      fileResults: new Map(),
    };

    // Process files in parallel batches
    const batchSize = 10;
    for (let i = 0; i < options.files.length; i += batchSize) {
      const batch = options.files.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (filePath) => {
          try {
            // Read file content
            const fs = await import('fs/promises');
            const content = await fs.readFile(filePath, 'utf-8');

            // Check cache
            if (this.cacheManager) {
              if (!this.cacheManager.needsProcessing(filePath, content, options.transformations)) {
                result.filesProcessed++;
                return;
              }
            }

            // Create backup if rollback enabled
            if (this.rollbackManager && !options.dryRun) {
              await this.rollbackManager.backupFile(filePath);
            }

            // Process file
            const fileResult = await this.fileProcessor.processFile(filePath, content, {
              transformations: options.transformations,
              useAI: options.useAI,
              aiService: options.aiService,
              generateTests: options.generateTests,
              showDiff: options.showDiff,
              classifyFiles: options.classifyFiles,
            });

            // Save processed file if modified
            if (fileResult.modified && !options.dryRun) {
              const fs = await import('fs/promises');
              await fs.writeFile(filePath, fileResult.code, 'utf-8');
            }

            // Update cache
            if (this.cacheManager && fileResult.modified) {
              this.cacheManager.markProcessed(filePath, fileResult.code, options.transformations);
            }

            // Update results
            result.filesProcessed++;
            if (fileResult.modified) {
              result.filesModified++;
            }
            result.transformationsApplied += fileResult.transformationsApplied;
            result.fileResults.set(filePath, fileResult);

            if (fileResult.issues.length > 0) {
              result.warnings.push(...fileResult.issues.map((issue) => `[${filePath}] ${issue}`));
            }
          } catch (error) {
            result.errors.push(
              `[${filePath}] ${error instanceof Error ? error.message : String(error)}`
            );
          }
        })
      );
    }

    return result;
  }
}
