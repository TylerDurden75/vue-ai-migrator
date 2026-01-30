import { CodemodRunner } from "../codemods/runner";
import { UnifiedAIService } from "../ai/unified-service";
import { MigrationClassifier, ClassificationResult } from "./classifier";
import type { IAIService, AgentResponse } from "../interfaces";
import { analyzeProject } from "../utils/analysis";
import { TestGenerator } from "../utils/codegen";
import { generateDiff, DiffResult } from "../utils/codegen";
import {
  validateProjectPath,
  safeReadFile,
  safeWriteFile,
  retry,
  MigrationError,
} from "../utils/safety";
import { RollbackManager } from "../utils/safety";
import { migratePackageJson } from "../utils/migration";
import { migrateWebpackConfig } from "../utils/migration/webpack-config-migrator";
import { validateMigration } from "../utils/migration";
import {
  fixPostMigrationIssues,
  fixImportPaths,
} from "../utils/migration/post-migration-fixer";
import { CacheManager } from "../utils/cache";
import { MigrationReporter, FileReport } from "./reporter";
import * as path from "path";
import { glob } from "glob";

export interface MigrationOptions {
  projectPath: string;
  aiApiKey?: string;
  aiProvider?: "openai" | "mistral" | "claude" | "anthropic";
  dryRun?: boolean;
  useAI?: boolean;
  outputReport?: string;
  transformations?: string[];
  enableRollback?: boolean;
  migratePackageJson?: boolean;
  validateAfterMigration?: boolean;
  useCache?: boolean;
  incremental?: boolean;
  generateTests?: boolean;
  showDiff?: boolean;
  classifyFiles?: boolean;
  enableTypeScript?: boolean;
}

export interface MigrationResult {
  filesAnalyzed: number;
  filesModified: number;
  transformationsApplied: number;
  errors: string[];
  warnings: string[];
  reportPath?: string;
  classification?: {
    simple: number;
    medium: number;
    complex: number;
  };
  diffs?: Record<string, DiffResult>;
  explanations?: Record<string, string>;
  testFilesGenerated?: number;
}

export async function migrate(
  options: MigrationOptions,
): Promise<MigrationResult> {
  const {
    projectPath,
    aiApiKey,
    aiProvider = "openai",
    dryRun = false,
    useAI = true,
    outputReport = "migration-report.json",
    enableRollback = true,
    migratePackageJson: shouldMigratePackage = true,
    validateAfterMigration: shouldValidate = true,
    useCache = true,
    incremental = false,
  } = options;

  const result: MigrationResult = {
    filesAnalyzed: 0,
    filesModified: 0,
    transformationsApplied: 0,
    errors: [],
    warnings: [],
  };

  try {
    // Validate project path
    validateProjectPath(projectPath);

    // Analyze the project
    const analysis = await analyzeProject(projectPath);

    // Find all Vue files
    const vueFiles = await glob("**/*.{vue,js,ts}", {
      cwd: projectPath,
      ignore: ["node_modules/**", "dist/**", "build/**"],
      absolute: true,
    });

    result.filesAnalyzed = vueFiles.length;

    if (vueFiles.length === 0) {
      result.warnings.push("No Vue files found in the project");
      return result;
    }

    // Initialize services
    const codemodRunner = new CodemodRunner();
    const migrationAgent: IAIService | null =
      useAI && aiApiKey
        ? new UnifiedAIService({
            provider: aiProvider,
            apiKey: aiApiKey,
          })
        : null;
    const classifier = new MigrationClassifier();
    const testGenerator = options.generateTests ? new TestGenerator() : null;
    const reporter = new MigrationReporter();
    const rollbackManager = enableRollback
      ? new RollbackManager(projectPath)
      : null;
    const cacheManager = useCache ? new CacheManager(projectPath) : null;

    // Track classification and diffs
    const fileReports: FileReport[] = [];
    const diffs: Record<string, DiffResult> = {};
    const classificationCounts = { simple: 0, medium: 0, complex: 0 };
    const explanations: Record<string, string> = {};

    // Load existing backups if rollback is enabled
    if (rollbackManager && !dryRun) {
      await rollbackManager.loadBackups();

      // Backup important configuration files before migration
      const configFiles = [
        path.join(projectPath, "package.json"),
        path.join(projectPath, "webpack.config.js"),
        path.join(projectPath, "vite.config.js"),
        path.join(projectPath, "vue.config.js"),
        path.join(projectPath, "tsconfig.json"),
      ];

      for (const configFile of configFiles) {
        try {
          await rollbackManager.backupFile(configFile);
        } catch {
          // File doesn't exist, skip silently
        }
      }
    }

    // Load cache if enabled
    if (cacheManager) {
      await cacheManager.loadCache();
    }

    // Cache for file content hashes to avoid reprocessing unchanged files (fallback)
    const fileCache = new Map<string, string>();

    // Determine transformations to apply
    let transformationsToApply =
      options.transformations ||
      Object.keys(CodemodRunner.AVAILABLE_TRANSFORMS);

    // If vuex-pinia is used, automatically add vuex-pinia-components
    if (
      transformationsToApply.includes("vuex-pinia") &&
      !transformationsToApply.includes("vuex-pinia-components")
    ) {
      transformationsToApply = [
        ...transformationsToApply,
        "vuex-pinia-components",
      ];
    }

    // Ensure vuex-pinia-components runs after vuex-pinia
    if (
      transformationsToApply.includes("vuex-pinia") &&
      transformationsToApply.includes("vuex-pinia-components")
    ) {
      const vuexIndex = transformationsToApply.indexOf("vuex-pinia");
      const componentsIndex = transformationsToApply.indexOf(
        "vuex-pinia-components",
      );
      if (componentsIndex < vuexIndex) {
        // Move vuex-pinia-components after vuex-pinia
        transformationsToApply.splice(componentsIndex, 1);
        transformationsToApply.splice(
          vuexIndex + 1,
          0,
          "vuex-pinia-components",
        );
      }
    }

    // Process files in parallel batches for better performance
    // Increased batch size for better scalability
    const BATCH_SIZE = Math.min(
      20,
      Math.max(10, Math.floor(vueFiles.length / 4) || 10),
    );
    const batches: string[][] = [];
    for (let i = 0; i < vueFiles.length; i += BATCH_SIZE) {
      batches.push(vueFiles.slice(i, i + BATCH_SIZE));
    }

    // Process batches sequentially, files within batch in parallel
    for (const batch of batches) {
      await Promise.all(
        batch.map(async (filePath) => {
          try {
            const content = await safeReadFile(filePath);

            // Check cache if enabled and incremental mode
            if (cacheManager && incremental) {
              if (
                !cacheManager.needsProcessing(
                  filePath,
                  content,
                  transformationsToApply,
                )
              ) {
                return; // Skip if already processed with same transformations
              }
            }

            // Create backup before modification if rollback is enabled
            if (rollbackManager && !dryRun) {
              await rollbackManager.backupFile(filePath);
            }

            // Simple hash-based cache check (fallback if cache manager not used)
            if (!cacheManager) {
              const contentHash = `${content.length}-${content.slice(0, 50)}-${content.slice(-50)}`;
              const cachedHash = fileCache.get(filePath);

              // Skip if file hasn't changed (simple optimization)
              if (cachedHash === contentHash && !dryRun) {
                return;
              }
            }

            // Classify file complexity
            let classification: ClassificationResult | undefined;
            if (options.classifyFiles !== false) {
              classification = await classifier.classify(filePath, content, {
                useAIForAnalysis: !!migrationAgent,
                aiService: migrationAgent
                  ? {
                      analyzeComplexity: async (code: string) => {
                        try {
                          const agentResult: AgentResponse =
                            await migrationAgent.migrate({
                              code,
                              filePath,
                              issues: [],
                              classification: "medium",
                            });
                          return {
                            complexity:
                              agentResult.confidence &&
                              agentResult.confidence > 0.8
                                ? "high"
                                : ("medium" as const),
                            recommendations: agentResult.suggestions || [],
                          };
                        } catch {
                          return {
                            complexity: "medium" as const,
                            recommendations: [],
                          };
                        }
                      },
                    }
                  : undefined,
              });
              const level = classification.level;
              if (
                level === "simple" ||
                level === "medium" ||
                level === "complex"
              ) {
                classificationCounts[level]++;
              }
            }

            // Apply codemod transformations
            const codemodResult = await codemodRunner.transform(
              filePath,
              content,
              {
                transformations: transformationsToApply,
                enableTypeScript: options.enableTypeScript || false,
              },
            );

            let finalCode = codemodResult.code;
            let migrated = codemodResult.modified;
            let explanation: string | undefined;

            // For complex cases, use MigrationAgent with retry logic
            if (
              migrationAgent &&
              (codemodResult.needsAI || classification?.level === "complex")
            ) {
              try {
                const agentResult: AgentResponse = await retry(
                  async () =>
                    migrationAgent!.migrate({
                      code: codemodResult.code,
                      filePath,
                      issues: codemodResult.issues,
                      classification: classification?.level || "medium",
                    }),
                  {
                    maxRetries: 2,
                    retryDelay: 1000,
                    onRetry: (attempt: number, error: Error) => {
                      result.warnings.push(
                        `AI retry attempt ${attempt} for ${filePath}: ${error.message}`,
                      );
                    },
                  },
                );

                if (agentResult.success && agentResult.migratedCode) {
                  finalCode = agentResult.migratedCode;
                  migrated = true;
                  explanation = agentResult.explanation;
                  result.transformationsApplied++;

                  // Generate tests if requested and migration successful
                  if (testGenerator && agentResult.migratedCode) {
                    try {
                      const componentName =
                        filePath.split("/").pop()?.replace(".vue", "") ||
                        "Component";
                      const testResult = await testGenerator.generateTest(
                        filePath,
                        agentResult.migratedCode,
                        {
                          componentName,
                        },
                      );
                      await testGenerator.writeTest(testResult);
                      result.testFilesGenerated =
                        (result.testFilesGenerated || 0) + 1;
                    } catch (error) {
                      result.warnings.push(
                        `Could not generate test for ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
                      );
                    }
                  }
                } else {
                  result.warnings.push(
                    `AI could not migrate ${filePath}: ${agentResult.reason || "Unknown reason"}`,
                  );
                }
              } catch (error) {
                result.errors.push(
                  `AI error for ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
                );
              }
            }

            // Generate diff if dry-run mode
            if (dryRun && migrated && content !== finalCode) {
              diffs[filePath] = generateDiff(content, finalCode);
              if (explanation) {
                explanations[filePath] = explanation;
              }
            }

            // Update cache
            if (cacheManager) {
              if (migrated) {
                cacheManager.markProcessed(
                  filePath,
                  finalCode,
                  transformationsToApply,
                );
              } else {
                cacheManager.markProcessed(
                  filePath,
                  content,
                  transformationsToApply,
                );
              }
            } else {
              // Fallback cache
              if (migrated) {
                fileCache.set(
                  filePath,
                  `${finalCode.length}-${finalCode.slice(0, 50)}-${finalCode.slice(-50)}`,
                );
              } else {
                const contentHash = `${content.length}-${content.slice(0, 50)}-${content.slice(-50)}`;
                fileCache.set(filePath, contentHash);
              }
            }

            if (migrated) {
              if (!dryRun) {
                // Apply post-migration fixes
                try {
                  const fixResult = await fixPostMigrationIssues(
                    filePath,
                    finalCode,
                  );
                  if (fixResult.fixed) {
                    finalCode = fixResult.content;
                    if (fixResult.fixes.length > 0) {
                      result.warnings.push(
                        `Post-migration fixes for ${path.relative(projectPath, filePath)}: ${fixResult.fixes.join(", ")}`,
                      );
                    }
                  }

                  // Fix import paths to use @ alias
                  finalCode = fixImportPaths(finalCode, projectPath, filePath);

                  // Report issues found but not fixed
                  if (fixResult.issues.length > 0) {
                    result.warnings.push(
                      `Issues detected in ${path.relative(projectPath, filePath)}: ${fixResult.issues.join(", ")}`,
                    );
                  }
                } catch (error) {
                  // If fixing fails, still write the file but warn
                  result.warnings.push(
                    `Post-migration fixer failed for ${path.relative(projectPath, filePath)}: ${error instanceof Error ? error.message : String(error)}`,
                  );
                }

                await safeWriteFile(filePath, finalCode);
              }
              result.filesModified++;
              result.transformationsApplied +=
                codemodResult.transformationsApplied;
            }

            // Create file report
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
              timeTaken: 0, // Time tracking can be added in future versions
            };

            if (dryRun && diffs[filePath]) {
              fileReport.diff = diffs[filePath];
            }

            if (explanation) {
              fileReport.explanation = explanation;
            }

            fileReports.push(fileReport);
          } catch (error) {
            if (error instanceof MigrationError) {
              result.errors.push(
                `[${error.code}] ${error.message}${error.filePath ? ` (${error.filePath})` : ""}`,
              );
            } else {
              result.errors.push(
                `Error processing ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
        }),
      );
    }

    // Add classification, diffs, and explanations to result
    result.classification = classificationCounts;
    if (dryRun && Object.keys(diffs).length > 0) {
      result.diffs = diffs;
    }
    if (Object.keys(explanations).length > 0) {
      result.explanations = explanations;
    }

    // Generate report
    if (outputReport) {
      const reportPath = await reporter.generateReport(
        result,
        fileReports,
        outputReport,
      );
      result.reportPath = reportPath;
    }

    // Migrate package.json if requested
    if (shouldMigratePackage) {
      try {
        // Backup package.json before migration if not already backed up
        const packageJsonPath = path.join(projectPath, "package.json");
        if (rollbackManager && !dryRun) {
          try {
            await rollbackManager.backupFile(packageJsonPath);
          } catch {
            // Already backed up or doesn't exist
          }
        }

        const packageResult = await migratePackageJson(projectPath, dryRun);
        if (packageResult.modified) {
          result.warnings.push(
            ...packageResult.changes.map((c) => `Package: ${c}`),
          );
          result.warnings.push(...packageResult.warnings);
        }
      } catch (error) {
        result.warnings.push(
          `Package migration error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Migrate webpack.config.js if it exists
    try {
      const webpackConfigPath = path.join(projectPath, "webpack.config.js");
      // Backup webpack.config.js before migration if not already backed up
      if (rollbackManager && !dryRun) {
        try {
          await rollbackManager.backupFile(webpackConfigPath);
        } catch {
          // Already backed up or doesn't exist
        }
      }

      const webpackResult = await migrateWebpackConfig(projectPath, dryRun);
      if (webpackResult.modified) {
        result.warnings.push(
          ...webpackResult.changes.map((c) => `Webpack: ${c}`),
        );
        result.warnings.push(...webpackResult.warnings);
      }
    } catch (error) {
      // webpack.config.js doesn't exist or error, that's fine
    }

    // Validate migration if requested
    let validationResult = null;
    if (shouldValidate && !dryRun) {
      try {
        validationResult = await validateMigration(projectPath);
        if (!validationResult.valid) {
          result.errors.push(...validationResult.errors);
        }
        result.warnings.push(...validationResult.warnings);
      } catch (error) {
        result.warnings.push(
          `Validation error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Save cache if enabled
    if (cacheManager && !dryRun) {
      await cacheManager.saveCache();
    }

    // Save backups if rollback is enabled
    if (rollbackManager && !dryRun && result.filesModified > 0) {
      await rollbackManager.saveBackups();
    }

    // Generate report
    if (outputReport) {
      try {
        const reportPath = path.resolve(projectPath, outputReport);
        const report = {
          timestamp: new Date().toISOString(),
          projectPath,
          analysis,
          result,
          dryRun,
          rollbackAvailable: rollbackManager
            ? rollbackManager.getBackupCount() > 0
            : false,
          validation: validationResult,
          suggestions: validationResult?.suggestions || [],
        };

        if (!dryRun) {
          await safeWriteFile(reportPath, JSON.stringify(report, null, 2));
          result.reportPath = reportPath;
        }
      } catch (error) {
        result.warnings.push(
          `Failed to generate report: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return result;
  } catch (error) {
    if (error instanceof MigrationError) {
      result.errors.push(
        `[${error.code}] ${error.message}${error.filePath ? ` (${error.filePath})` : ""}`,
      );
    } else {
      result.errors.push(
        `General error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    // Don't throw, return result with errors instead
    return result;
  }
}
