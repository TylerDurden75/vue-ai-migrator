/**
 * Migration pipeline steps: per-file processing and second-pass fixer.
 * Keeps the migrator as a thin orchestrator.
 */

import * as path from "path";
import * as fs from "fs/promises";
import type { MigrationServices } from "./migration-services";
import type { MigrationClassifier, ClassificationResult } from "./classifier";
import type { FileReport } from "./reporter";
import type { TestGenerator } from "../utils/codegen";
import type { DiffResult } from "../utils/codegen";
import type { AgentResponse } from "../interfaces";
import { safeReadFile, safeWriteFile, retry } from "../utils/safety";
import { generateDiff } from "../utils/codegen";
export interface ProcessOneFileOptions {
  enableTypeScript?: boolean;
  verbose?: boolean;
  classifyFiles?: boolean;
  generateTests?: boolean;
}

export interface ProcessOneFileParams {
  filePath: string;
  content: string;
  projectPath: string;
  dryRun: boolean;
  options: ProcessOneFileOptions;
  services: MigrationServices;
  transformationsToApply: string[];
  fileCache: Map<string, string>;
  classifier: MigrationClassifier;
  testGenerator: TestGenerator | null;
}

export interface ProcessOneFileResult {
  fileReport: FileReport;
  filesModifiedDelta: number;
  transformationsAppliedDelta: number;
  testFilesGeneratedDelta: number;
  errors: string[];
  warnings: string[];
  classificationLevel?: "simple" | "medium" | "complex";
  diff?: DiffResult;
  explanation?: string;
}

export async function processOneFile(
  params: ProcessOneFileParams
): Promise<ProcessOneFileResult> {
  const {
    filePath,
    content,
    projectPath,
    dryRun,
    options,
    services,
    transformationsToApply,
    fileCache,
    classifier,
    testGenerator,
  } = params;
  const {
    codemodRunner,
    aiService: migrationAgent,
    cacheManager,
    rollbackManager,
    fixPostMigration: fixPostMigrationFn,
  } = services;

  const errors: string[] = [];
  const warnings: string[] = [];
  let filesModifiedDelta = 0;
  let transformationsAppliedDelta = 0;
  let testFilesGeneratedDelta = 0;
  let classificationLevel: "simple" | "medium" | "complex" | undefined;
  let diff: DiffResult | undefined;
  let explanation: string | undefined;

  // Classify file complexity
  let classification: ClassificationResult | undefined;
  if (options.classifyFiles !== false) {
    classification = await classifier.classify(filePath, content, {
      useAIForAnalysis: !!migrationAgent,
      aiService: migrationAgent
        ? {
            analyzeComplexity: async (code: string) => {
              try {
                const agentResult: AgentResponse = await migrationAgent.migrate({
                  code,
                  filePath,
                  issues: [],
                  classification: "medium",
                });
                return {
                  complexity:
                    agentResult.confidence && agentResult.confidence > 0.8
                      ? "high"
                      : ("medium" as const),
                  recommendations: agentResult.suggestions || [],
                };
              } catch {
                return { complexity: "medium" as const, recommendations: [] };
              }
            },
          }
        : undefined,
    });
    classificationLevel = classification?.level;
  }

  const codemodResult = await codemodRunner.transform(filePath, content, {
    transformations: transformationsToApply,
    enableTypeScript: options.enableTypeScript || false,
  });

  let finalCode = codemodResult.code;
  let migrated = codemodResult.modified;

  if (
    migrated &&
    finalCode === content &&
    options.verbose
  ) {
    warnings.push(
      `DEBUG: ${path.relative(projectPath, filePath)} marked as migrated but codemod code === original content`
    );
  }

  if (
    migrationAgent &&
    (codemodResult.needsAI || classification?.level === "complex")
  ) {
    try {
      const agentResult: AgentResponse = await retry(
        () =>
          migrationAgent.migrate({
            code: codemodResult.code,
            filePath,
            issues: codemodResult.issues,
            classification: classification?.level || "medium",
          }),
        {
          maxRetries: 2,
          retryDelay: 1000,
          onRetry: (attempt: number, error: Error) => {
            warnings.push(
              `AI retry attempt ${attempt} for ${filePath}: ${error.message}`
            );
          },
        }
      );

      if (agentResult.success && agentResult.migratedCode) {
        finalCode = agentResult.migratedCode;
        migrated = true;
        explanation = agentResult.explanation;
        transformationsAppliedDelta++;
      } else {
        warnings.push(
          `AI could not migrate ${filePath}: ${agentResult.reason || "Unknown reason"}`
        );
      }
    } catch (error) {
      errors.push(
        `AI error for ${filePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Generate tests for migrated Vue components (codemod or AI path)
  if (
    testGenerator &&
    migrated &&
    finalCode !== content &&
    filePath.endsWith(".vue") &&
    !dryRun
  ) {
    try {
      const componentName =
        filePath.split("/").pop()?.replace(".vue", "") || "Component";
      const testResult = await testGenerator.generateTest(
        filePath,
        finalCode,
        { componentName }
      );
      const testPath = path.resolve(projectPath, testResult.filePath);
      const testExisted = await fs
        .access(testPath)
        .then(() => true)
        .catch(() => false);
      if (rollbackManager && testExisted) {
        await rollbackManager.backupFile(testPath);
      }
      await testGenerator.writeTest(testResult);
      if (rollbackManager && !testExisted) {
        rollbackManager.addCreatedFile(testPath);
      }
      testFilesGeneratedDelta = 1;
    } catch (error) {
      warnings.push(
        `Could not generate test for ${filePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (dryRun && migrated && content !== finalCode) {
    diff = generateDiff(content, finalCode);
  }

  if (cacheManager) {
    cacheManager.markProcessed(
      filePath,
      migrated ? finalCode : content,
      transformationsToApply
    );
  } else {
    if (migrated) {
      fileCache.set(
        filePath,
        `${finalCode.length}-${finalCode.slice(0, 50)}-${finalCode.slice(-50)}`
      );
    } else {
      fileCache.set(
        filePath,
        `${content.length}-${content.slice(0, 50)}-${content.slice(-50)}`
      );
    }
  }

  const isMixinFile =
    filePath.includes("/mixins/") ||
    filePath.includes("mixin.ts") ||
    filePath.includes("mixin.js");

  if (migrated || isMixinFile) {
    if (options.verbose) {
      warnings.push(
        `DEBUG: Processing ${path.relative(projectPath, filePath)} - migrated=${migrated}, dryRun=${dryRun}, isMixinFile=${isMixinFile}`
      );
    }

    let fixResult: { fixed: boolean; content: string; fixes: string[]; issues: string[] } | null = null;

    if (!dryRun) {
      try {
        fixResult = await fixPostMigrationFn(
          filePath,
          finalCode,
          options.enableTypeScript || false,
          projectPath
        );
        if (fixResult.fixed) {
          finalCode = fixResult.content;
          if (options.verbose && fixResult.fixes.length > 0) {
            warnings.push(
              `Post-migration fixes for ${path.relative(projectPath, filePath)}: ${fixResult.fixes.join(", ")}`
            );
          }
        }
        if (fixResult && fixResult.issues.length > 0) {
          warnings.push(
            `Issues detected in ${path.relative(projectPath, filePath)}: ${fixResult.issues.join(", ")}`
          );
        }
      } catch (error) {
        warnings.push(
          `Post-migration fixer failed for ${path.relative(projectPath, filePath)}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    const shouldProcess = finalCode !== content || isMixinFile;

    if (options.verbose && isMixinFile) {
      warnings.push(
        `DEBUG: Processing mixin file ${path.relative(projectPath, filePath)} - shouldProcess=${shouldProcess}`
      );
    }

    if (shouldProcess) {
      if (!dryRun) {
        if (
          finalCode !== content ||
          (isMixinFile && fixResult && fixResult.fixed)
        ) {
          try {
            let targetFilePath = filePath;
            if (
              options.enableTypeScript &&
              filePath.endsWith(".js") &&
              !filePath.endsWith(".vue")
            ) {
              const newFilePath = filePath.replace(/\.js$/, ".ts");
              if (rollbackManager) {
                await rollbackManager.backupFile(filePath);
              }
              try {
                await fs.unlink(filePath);
              } catch {
                // ignore
              }
              targetFilePath = newFilePath;
              warnings.push(
                `Renamed ${path.relative(projectPath, filePath)} → ${path.relative(projectPath, newFilePath)} (TypeScript)`
              );
            }

            await safeWriteFile(targetFilePath, finalCode);
            const writtenContent = await safeReadFile(targetFilePath);
            if (writtenContent !== finalCode) {
              warnings.push(
                `File ${path.relative(projectPath, targetFilePath)} was written but content doesn't match expected result`
              );
            } else if (options.verbose) {
              warnings.push(
                `✓ Successfully migrated ${path.relative(projectPath, targetFilePath)}`
              );
            }
          } catch (error) {
            errors.push(
              `Failed to write ${path.relative(projectPath, filePath)}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        } else {
          warnings.push(
            `File ${path.relative(projectPath, filePath)} was transformed but post-fixes restored original content`
          );
        }
      }
      filesModifiedDelta = 1;
    } else {
      warnings.push(
        `File ${path.relative(projectPath, filePath)} marked as migrated but content unchanged`
      );
    }
    transformationsAppliedDelta += codemodResult.transformationsApplied;
  }

  const fileReport: FileReport = {
    filePath,
    classification: classification || {
      level: "medium",
      confidence: 0.5,
      reasons: [],
      requiresAI: false,
      autoMigratable: true,
    },
    migrated,
    transformationsApplied: migrated ? transformationsToApply : [],
    timeTaken: 0,
  };
  if (diff) fileReport.diff = diff;
  if (explanation) fileReport.explanation = explanation;

  return {
    fileReport,
    filesModifiedDelta,
    transformationsAppliedDelta,
    testFilesGeneratedDelta,
    errors,
    warnings,
    classificationLevel,
    diff,
    explanation,
  };
}
