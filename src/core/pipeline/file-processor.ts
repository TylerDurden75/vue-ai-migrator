/**
 * File Processor - Handles individual file processing during migration
 * Extracted from migrator.ts to reduce complexity
 */

import { CodemodRunner } from '../../codemods/runner';
import { MigrationClassifier, ClassificationResult } from '../classifier';
import { TestGenerator } from '../../utils/codegen';
import { generateDiff, DiffResult } from '../../utils/codegen';
import type { FileProcessingOptions, FileProcessingResult } from '../../interfaces';

export class FileProcessor {
  constructor(
    private codemodRunner: CodemodRunner,
    private classifier: MigrationClassifier,
    private testGenerator: TestGenerator | null = null
  ) {}

  /**
   * Process a single file through the migration pipeline
   */
  async processFile(
    filePath: string,
    content: string,
    options: FileProcessingOptions
  ): Promise<FileProcessingResult> {
    const result: FileProcessingResult = {
      modified: false,
      code: content,
      transformationsApplied: 0,
      needsAI: false,
      issues: [],
    };

    try {
      // Classify file complexity if requested
      let classification: ClassificationResult | undefined;
      if (options.classifyFiles) {
        classification = await this.classifier.classify(filePath, content, {
          useAIForAnalysis: !!options.aiService,
          aiService: options.aiService
            ? {
                analyzeComplexity: async (code: string) => {
                  if (!options.aiService) {
                    return { complexity: 'medium' as const, recommendations: [] };
                  }
                  const analysis = await options.aiService.analyzeComplexity(code);
                  return {
                    complexity: analysis.complexity,
                    recommendations: analysis.recommendations,
                  };
                },
              }
            : undefined,
        });
      }

      // Apply codemod transformations
      const codemodResult = await this.codemodRunner.transform(filePath, content, {
        transformations: options.transformations,
      });

      let finalCode = codemodResult.code;
      let migrated = codemodResult.modified;
      let explanation: string | undefined;

      // For complex cases, use AI service
      if (options.aiService && (codemodResult.needsAI || classification?.level === 'complex')) {
        try {
          const agentResult = await options.aiService.migrate({
            code: codemodResult.code,
            filePath,
            issues: codemodResult.issues,
            classification: classification?.level || 'medium',
          });

          if (agentResult.success && agentResult.migratedCode) {
            finalCode = agentResult.migratedCode;
            migrated = true;
            explanation = agentResult.explanation;
            result.transformationsApplied++;

            // Generate tests if requested
            if (this.testGenerator && options.generateTests && agentResult.migratedCode) {
              try {
                const componentName = filePath.split('/').pop()?.replace('.vue', '') || 'Component';
                const testResult = await this.testGenerator.generateTest(
                  filePath,
                  agentResult.migratedCode,
                  {
                    componentName,
                  }
                );
                await this.testGenerator.writeTest(testResult);
                result.testCode = testResult.content;
              } catch (error) {
                result.issues.push(
                  `Could not generate test: ${error instanceof Error ? error.message : String(error)}`
                );
              }
            }
          } else {
            result.issues.push(agentResult.reason || 'AI migration failed');
          }
        } catch (error) {
          result.issues.push(
            `AI migration error: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // Generate diff if requested
      let diff: DiffResult | undefined;
      if (options.showDiff && migrated && finalCode !== content) {
        diff = generateDiff(content, finalCode);
      }

      result.modified = migrated;
      result.code = finalCode;
      result.transformationsApplied += codemodResult.transformationsApplied;
      result.needsAI = codemodResult.needsAI;
      result.issues.push(...codemodResult.issues);
      result.classification = classification;
      result.diff = diff;
      result.explanation = explanation;

      return result;
    } catch (error) {
      result.issues.push(
        `Processing error: ${error instanceof Error ? error.message : String(error)}`
      );
      return result;
    }
  }
}
